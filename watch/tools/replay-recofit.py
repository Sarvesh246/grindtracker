"""Create an offline simulator test project from the RecoFit CSV export in AUDIT.md."""

import argparse
import csv
import json
import shutil
import tempfile
from pathlib import Path


def read_csv(path):
    with path.open(newline="", encoding="utf-8-sig") as stream:
        yield from csv.DictReader(stream)


def create_replay(data_dir, split):
    watch = Path(__file__).resolve().parents[1]
    out = Path(tempfile.mkdtemp(prefix="grind-recofit-"))
    src = out / "source"
    src.mkdir()
    for path in watch.joinpath("source").glob("*.mc"):
        if path.name not in {"Secrets.mc", "Tests.mc"}:
            shutil.copy(path, src)
    shutil.copy(watch / "secrets/Secrets.example.mc", src / "Secrets.mc")
    shutil.copy(watch / "monkey.jungle", out)
    shutil.copytree(watch / "resources", out / "resources")
    manifest = (watch / "manifest.xml").read_text().replace(
        "7c3a1e9b5d2f4a86b0c4e8f1a6d39b27", "458eb2acdd564981842983f273c4bb04"
    )
    (out / "manifest.xml").write_text(manifest)
    config = src / "Config.mc"
    config.write_text(config.read_text().replace("DEMO_DATA = false", "DEMO_DATA = true"))
    recordings = {}
    for row in read_csv(data_dir / "recordings.csv"):
        if int(row["subject_id"]) % 2 != (split == "heldout"):
            continue
        if int(row["incomplete_data"]) or not row["activity_reps"] or int(row["activity_reps"]) < 1:
            continue
        recordings[row["record_uid"]] = (int(row["activity_reps"]), [])
    for row in read_csv(data_dir / "samples.csv"):
        if row["record_uid"] in recordings:
            recordings[row["record_uid"]][1].append([float(row[f"accel_{axis}_g"]) for axis in "xyz"])

    resources = out / "resources/replay"
    resources.mkdir()
    tags, tests = [], []
    for count, raw in recordings.values():
        if not 2 <= len(raw) <= 3752:
            continue
        name = f"Trace{len(tags)}"
        # Average pairs of original 50 Hz readings to produce 25 Hz in millig.
        axes = [[round(500 * (a[k] + b[k])) for a, b in zip(raw[::2], raw[1::2])] for k in range(3)]
        (resources / f"{name}.json").write_text(json.dumps(axes))
        tags.append(f'<jsonData id="{name}" filename="{name}.json"/>')
        tests.append(f"(:test) function replay{name}(logger) {{ return Replay.run(Rez.JsonData.{name}, {count}); }}")
    (resources / "resources.xml").write_text("<resources>\n" + "\n".join(tags) + "\n</resources>")
    driver = Path(__file__).with_name("replay-driver.mc").read_text()
    (src / "Replay.mc").write_text(driver + "\n" + "\n".join(tests))
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("split", choices=["dev", "heldout"])
    args = parser.parse_args()
    print(create_replay(args.data_dir, args.split))
