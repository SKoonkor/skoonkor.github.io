#!/usr/bin/env python3
"""Package a "Gravity from Scratch" lecture's hints and solution into downloadable zips.

Reads from the course source repo (claudeMade/codeHints/Lxx and claudeMade/solutions/Lxx)
and writes two zips per lecture: a hints zip (skeleton + experiment scaffold + checker) and a
solution zip (the reference implementation). Both zips share one folder layout, so a learner
who unpacks both into the same place gets a single working tree:

    gravity-from-scratch/
        README.txt
        course/codeHints/L01/{hw1_direct_skeleton.py, hw1_run_experiments.py, check_hw1.py}
        course/solutions/L01/direct.py          (solution zip only)
        myOwnCode/L01/README.txt

That layout matters: check_hw1.py finds the learner's code with
`Path(__file__).resolve().parents[3] / "myOwnCode" / "L01"`, i.e. three directories up from the
checker plus myOwnCode/L01. "course/" here is a straight rename of "claudeMade/" (same depth),
so that path arithmetic keeps working unmodified -- only the docstring text needs updating from
one name to the other.

Usage:
    python tools/nbody/package_downloads.py --src /path/to/myNBODYsim/claudeMade \
        --lectures L01 --out public/downloads/nbody

Deliberately stdlib-only: this only needs to run occasionally, by hand, when a lecture is
published, and does not belong in the site's own dependency graph.
"""
from __future__ import annotations

import argparse
import re
import shutil
import zipfile
from pathlib import Path

ROOT_NAME = "gravity-from-scratch"


def rewrite_claudemade_references(text: str) -> str:
	"""claudeMade/ -> course/ in comments and docstrings; code logic is untouched."""
	return text.replace("claudeMade/", "course/")


def copy_py_files(src_dir: Path, dst_dir: Path) -> list[str]:
	dst_dir.mkdir(parents=True, exist_ok=True)
	names = []
	for f in sorted(src_dir.glob("*.py")):
		text = f.read_text(encoding="utf-8")
		(dst_dir / f.name).write_text(rewrite_claudemade_references(text), encoding="utf-8")
		names.append(f.name)
	return names


def build_hints(src: Path, lecture: str, staging: Path) -> Path:
	"""lecture like 'L01' -> a hw1_direct_skeleton.py etc. Returns the staged root dir."""
	hw_n = re.match(r"L0*(\d+)", lecture).group(1)
	root = staging / "hints" / ROOT_NAME
	if root.exists():
		shutil.rmtree(root)

	hints_src = src / "codeHints" / lecture
	hints_dst = root / "course" / "codeHints" / lecture
	names = copy_py_files(hints_src, hints_dst)

	my_own = root / "myOwnCode" / lecture
	my_own.mkdir(parents=True, exist_ok=True)
	skeleton = next((n for n in names if "skeleton" in n), None)
	(my_own / "README.txt").write_text(
		f"Copy course/codeHints/{lecture}/{skeleton} here and rename it to match the module\n"
		f"the checker imports (see that file's own docstring for the exact name).\n"
		f"If codeHints/{lecture} has a *_run_experiments.py file, copy that here too, next to\n"
		f"your own code, before running it.\n",
		encoding="utf-8",
	)

	(root / "README.txt").write_text(
		f"Gravity from Scratch -- Lecture {hw_n} hints\n"
		f"{'=' * 40}\n\n"
		f"Requires Python 3 with numpy (and matplotlib for the experiment scripts).\n\n"
		f"1. Read course/codeHints/{lecture}/ -- it has a skeleton with the functions you\n"
		f"   need to write, and small scripts for plots and timing.\n"
		f"2. Follow myOwnCode/{lecture}/README.txt to set up your own copy.\n"
		f"3. Check your work:\n"
		f"       cd {ROOT_NAME}\n"
		f"       python course/codeHints/{lecture}/check_hw{hw_n}.py\n"
		f"   (or pass a folder explicitly: ... check_hw{hw_n}.py path/to/your/{lecture})\n"
		f"   Each line prints PASS or FAIL. Aim for all PASS before moving on.\n"
		f"4. Only once you're all green, get the reference-solution zip from the lecture\n"
		f"   page and compare it with your own code.\n",
		encoding="utf-8",
	)
	return root


def build_solution(src: Path, lecture: str, staging: Path) -> Path:
	root = staging / "solution" / ROOT_NAME
	if root.exists():
		shutil.rmtree(root)

	sol_src = src / "solutions" / lecture
	sol_dst = root / "course" / "solutions" / lecture
	copy_py_files(sol_src, sol_dst)

	# Named to not collide with the hints zip's own README.txt when both are
	# unzipped into the same folder -- unzip would otherwise prompt to overwrite.
	(root / "SOLUTION-README.txt").write_text(
		"Gravity from Scratch -- reference solution\n"
		"===========================================\n\n"
		"This is the reference implementation for this lecture's homework. Open it only\n"
		"after your own attempt passes the checker in the hints zip -- that comparison is\n"
		"most of the point of the exercise. Later lectures build on your own code, not on\n"
		"this file, so copying it in place of your own work will make later checkers fail\n"
		"in confusing ways.\n",
		encoding="utf-8",
	)
	return root


def zip_dir(root: Path, out_path: Path) -> None:
	out_path.parent.mkdir(parents=True, exist_ok=True)
	if out_path.exists():
		out_path.unlink()
	with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
		for f in sorted(root.rglob("*")):
			if f.is_file():
				zf.write(f, arcname=str(Path(ROOT_NAME) / f.relative_to(root)))


def main() -> None:
	ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
	ap.add_argument("--src", required=True, type=Path, help="path to claudeMade/")
	ap.add_argument("--lectures", required=True, nargs="+", help="e.g. L01 L02")
	ap.add_argument("--out", required=True, type=Path, help="public download directory")
	ap.add_argument(
		"--staging",
		type=Path,
		default=Path(__file__).parent / "staging",
		help="scratch directory for the unzipped tree (gitignored)",
	)
	args = ap.parse_args()

	for lecture in args.lectures:
		hints_root = build_hints(args.src, lecture, args.staging)
		solution_root = build_solution(args.src, lecture, args.staging)

		hints_zip = args.out / f"{lecture}-hints.zip"
		solution_zip = args.out / f"{lecture}-solution.zip"
		zip_dir(hints_root, hints_zip)
		zip_dir(solution_root, solution_zip)
		print(f"{lecture}: wrote {hints_zip} and {solution_zip}")


if __name__ == "__main__":
	main()
