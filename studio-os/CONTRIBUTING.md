# Contributing
1. Open or pick an issue (use the templates). One issue = one owning agent label.
2. Branch `agent/<agent>/<short-topic>`.
3. Small, focused commits. Canon, workflow, finance, automation or publishing → PR with the full template.
4. Work isn't done until it meets the Definition of Done (`AGENT_PROTOCOL.md` §6).
5. Asset naming: `<type>_<project>_<exp-id>_<slug>_v<NN>.<ext>` (e.g. `img_pm_cal01_meadow-front_v03.png`). Checked by `asset-validation.yml`.
6. Before any PR: `python3 08_AUTOMATION/scripts/validate_assets.py && python3 -m unittest discover -s tests`.
7. Heavy binaries (>5 MB) go to Google Drive; the repo only stores an index entry with the link.
