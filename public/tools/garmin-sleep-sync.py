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
    pip install garminconnect
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
    sys.exit("Missing dependency. Run: pip install garminconnect")

TOKENSTORE = os.path.expanduser("~/.garmin-grind")


def login() -> "Garmin":
    # Resume from the saved session; fall back to an interactive login (with MFA).
    try:
        api = Garmin()
        api.login(TOKENSTORE)
        return api
    except Exception:
        pass
    email = os.environ.get("GARMIN_EMAIL") or input("Garmin email: ")
    password = os.environ.get("GARMIN_PASSWORD") or getpass.getpass("Garmin password: ")
    api = Garmin(email=email, password=password, prompt_mfa=lambda: input("Garmin MFA code: "))
    api.login()
    try:
        api.garth.dump(TOKENSTORE)
    except Exception as err:  # saving the session is a convenience only
        print(f"(could not save the session: {err})", file=sys.stderr)
    return api


def post(url: str, token: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url.rstrip("/") + "/api/watch/v1/health-import",
        data=json.dumps(payload).encode(),
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
    args = parser.parse_args()
    url, token = os.environ.get("GRIND_URL"), os.environ.get("GRIND_TOKEN")
    if not url or not token:
        sys.exit("Set GRIND_URL and GRIND_TOKEN first (see the top of this file).")
    days = max(1, min(90, args.days))

    api = login()
    today = datetime.date.today()
    nights = []
    for back in range(days):
        day = (today - datetime.timedelta(days=back)).isoformat()
        try:
            data = api.get_sleep_data(day)
        except Exception as err:
            print(f"{day}: skipped ({err})", file=sys.stderr)
            continue
        sleep = (data or {}).get("dailySleepDTO") or {}
        if not sleep.get("sleepTimeSeconds"):
            continue
        summary = data.get("hrvSummary") or {}
        reported = (data.get("avgOvernightHrv"), sleep.get("avgOvernightHrv"), summary.get("lastNightAvg"))
        if not any(isinstance(value, (int, float)) and 1 <= value <= 500 for value in reported):
            try:
                hr = api.get_hrv_data(day) or {}
                if hr.get("hrvSummary"):
                    data["hrvSummary"] = hr["hrvSummary"]
            except Exception as err:
                print(f"{day}: overnight HRV unavailable ({type(err).__name__})", file=sys.stderr)
        nights.append(data)
    print(f"Fetched {len(nights)} nights from Garmin.")
    if args.dry_run or not nights:
        return
    # Small requests: GRIND accepts up to 1 MB, a night with a timeline is ~30 KB.
    for i in range(0, len(nights), 14):
        result = post(url, token, {"kind": "garmin_api", "days": nights[i : i + 14]})
        print(f"Imported {result.get('imported')} nights; skipped {len(result.get('skipped', []))}.")


if __name__ == "__main__":
    main()
