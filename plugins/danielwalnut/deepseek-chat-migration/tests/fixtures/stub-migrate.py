import argparse
import json
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["plan", "apply"])
    parser.add_argument("--source", required=True)
    parser.add_argument("--source-db", required=True)
    parser.add_argument("--session", action="append", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--target-data-dir", required=True)
    parser.add_argument("--agent", required=True)
    args = parser.parse_args()

    status = "planned" if args.action == "plan" else "imported"
    report = {
        "ok": True,
        "action": args.action,
        "source": args.source,
        "source_db": args.source_db,
        "target_data_dir": args.target_data_dir,
        "agent": args.agent,
        "sessions": [
            {
                "session_id": session_id,
                "status": status,
                "target_session_id": f"mcode-{session_id}" if args.action == "apply" else None,
            }
            for session_id in args.session
        ],
    }
    Path(args.report).write_text(json.dumps(report), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
