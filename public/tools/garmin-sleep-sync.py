#!/usr/bin/env python3
"""
GRIND ← Garmin sleep sync (unofficial, owner-run).

Logs in to YOUR Garmin Connect account on THIS computer, reads your recent sleep
nights, and sends them to GRIND with a GRIND device token. Your Garmin password
never goes to GRIND: it is typed here, and only a refreshable session token is
kept locally in ~/.garmin-grind (delete that folder to log out).

This uses the community `garminconnect` library, which talks to Garmin's private
web API. That is against Garmin's terms of service and can break whenever Garmin
changes things. Use it only for your own account, at your own risk. It has not been
verified against a live account by GRIND's author.

Setup (once):
    pip install "garminconnect>=0.3,<0.4"
    export GRIND_URL="https://YOUR-GRIND-DOMAIN"     # no trailing slash
    export GRIND_TOKEN="gwt_..."                      # Settings → Sleep & health sources
Run (now, or from cron/launchd every morning):
    python3 garmin-sleep-sync.py --days 14
"""
import argparse
import datetime
import getpass
import json
import os
import sys
import urllib.error
import urllib.request

try:
    from garminconnect import Garmin
except ImportError:
    sys.exit('Missing dependency. Run: pip install "garminconnect>=0.3,<0.4"')

TOKENSTORE = os.path.expanduser("~/.garmin-grind")


def login(non_interactive: bool) -> "Garmin":
    # Resume from the saved session; fall back to an interactive login (with MFA).
    try:
        api = Garmin()
        api.login(TOKENSTORE)
        return api
    except Exception:
        pass
    if non_interactive or not sys.stdin.isatty():
        sys.exit("Garmin sign-in is needed. Run once in a terminal to create or refresh the local session.")
    email = os.environ.get("GARMIN_EMAIL") or input("Garmin email: ")
    password = os.environ.get("GARMIN_PASSWORD") or getpass.getpass("Garmin password: ")
    api = Garmin(email=email, password=password, prompt_mfa=lambda: input("Garmin MFA code: "))
    try:
        api.login(TOKENSTORE)
    except Exception as err:
        sys.exit(f"Garmin sign-in failed ({type(err).__name__}). Try signing in again in a terminal.")
    return api


def overnight_hrv(data: dict, day: str):
    sleep = data.get("dailySleepDTO") or {}
    summary = data.get("hrvSummary") or {}
    values = [data.get("avgOvernightHrv"), sleep.get("avgOvernightHrv")]
    if summary.get("calendarDate") in (None, day):
        values.append(summary.get("lastNightAvg"))
    return next((value for value in values if type(value) in (int, float) and 1 <= value <= 500), None)


def upload_batches(nights: list[dict]):
    """Keep JSON requests within the server limit, even with large sleep timelines."""
    batch = []
    size = 100
    for night in nights:
        night_size = len(json.dumps(night, separators=(",", ":")).encode()) + 1
        if night_size > 899900:
            sys.exit("One night exceeds GRIND's upload limit.")
        if batch and (size + night_size > 900000 or len(batch) == 14):
            yield batch
            batch, size = [], 100
        batch.append(night)
        size += night_size
    if batch:
        yield batch


def post(url: str, token: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url.rstrip("/") + "/api/watch/v1/health-import",
        data=json.dumps(payload, separators=(",", ":")).encode(),
        headers={"content-type": "application/json", "authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        sys.exit(f"GRIND refused the upload ({err.code}): {err.read().decode()[:300]}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, default=7, help="how many past nights to send (1-90)")
    parser.add_argument("--dry-run", action="store_true", help="fetch but do not upload")
    parser.add_argument("--non-interactive", action="store_true", help="use the saved session only; fail instead of prompting")
    parser.add_argument("--require-hrv", action="store_true", help="fail if no overnight HRV can be fetched")
    args = parser.parse_args()
    url, token = os.environ.get("GRIND_URL"), os.environ.get("GRIND_TOKEN")
    if not args.dry_run and (not url or not token):
        sys.exit("Set GRIND_URL and GRIND_TOKEN first (see the top of this file).")
    days = max(1, min(90, args.days))

    api = login(args.non_interactive)
    today = api.today()
    nights = []
    hrv_dates = []
    sleep_failures = 0
    for back in range(days):
        day = (today - datetime.timedelta(days=back)).isoformat()
        try:
            data = api.get_sleep_data(day)
        except Exception as err:
            sleep_failures += 1
            print(f"{day}: sleep fetch failed ({type(err).__name__})", file=sys.stderr)
            continue
        sleep = (data or {}).get("dailySleepDTO") or {}
        if not sleep.get("sleepTimeSeconds"):
            continue
        if sleep.get("calendarDate") not in (None, day):
            print(f"{day}: Garmin returned sleep for a different date.", file=sys.stderr)
            continue
        if overnight_hrv(data, day) is None:
            try:
                hr = api.get_hrv_data(day) or {}
                if hr.get("hrvSummary"):
                    data["hrvSummary"] = hr["hrvSummary"]
            except Exception as err:
                print(f"{day}: overnight HRV unavailable ({type(err).__name__})", file=sys.stderr)
        hrv = overnight_hrv(data, day)
        if hrv is not None:
            hrv_dates.append(day)
        # Keep only fields used by the GRIND sleep importer.
        nights.append({
            "dailySleepDTO": sleep,
            "sleepLevels": data.get("sleepLevels"),
            "avgOvernightHrv": hrv,
        })
    print(f"Fetched {len(nights)} nights from Garmin, {len(hrv_dates)} with overnight HRV.")
    if hrv_dates:
        print(f"Overnight HRV dates: {', '.join(hrv_dates)}")
    if not nights:
        sys.exit("Garmin sleep fetch failed for at least one day." if sleep_failures else "No sleep data has synced to Garmin Connect for these dates.")
    if args.require_hrv and not hrv_dates:
        sys.exit("No Garmin overnight HRV is available for these dates.")
    if args.dry_run:
        return
    imported = 0
    skipped = 0
    for batch in upload_batches(nights):
        result = post(url, token, {"kind": "garmin_api", "days": batch})
        imported += result.get("imported", 0)
        skipped += len(result.get("skipped", []))
    print(f"Imported {imported} nights; skipped {skipped}.")
    if not imported:
        sys.exit("GRIND did not accept any nights.")


if __name__ == "__main__":
    main()
