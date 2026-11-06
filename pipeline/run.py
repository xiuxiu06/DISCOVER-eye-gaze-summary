"""Writes app/public/data/*.json and prints the funnel numbers. Run: python -m pipeline.run"""

import pandas as pd

from . import config
from .export import build_outputs, write_outputs
from .load import load_rows


def main() -> None:
    if not config.LANE_MAP.exists():
        raise SystemExit("data/lane_map.csv is missing. Create a draft with: python -m pipeline.lane_map")
    outputs = build_outputs(
        load_rows(config.RAW_LOG), pd.read_csv(config.LANE_MAP), f"{config.RAW_LOG.name}. {config.LANE_MAP_NOTE}"
    )
    write_outputs(outputs, config.OUTPUT_DIR)
    for step in outputs["funnel"]:
        print(f"{step['step']:<26} {step['rows']:>8,} rows  {step['seconds']:>10,.1f} s   {step['note']}")
    print(f"Wrote {len(outputs)} files to {config.OUTPUT_DIR}")


if __name__ == "__main__":
    main()
