import importlib.util
from itertools import islice
from pathlib import Path
import unittest

CONFIGURATION_ROOT = Path(__file__).resolve().parent
DIRECTORY_COUNT_MAX = 64
DASHBOARD_IMAGES_COUNT = 14
SPECIFICATION = importlib.util.spec_from_file_location("shared_setup_build", CONFIGURATION_ROOT / "build.py")
BUILD = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(BUILD)


class SharedSetupTests(unittest.TestCase):
    def test_every_shared_skill_is_the_same_directory_in_both_clients(self):
        root = CONFIGURATION_ROOT / "shared/skills"
        skills = list(islice(root.iterdir(), DIRECTORY_COUNT_MAX + 1))
        self.assertLessEqual(len(skills), DIRECTORY_COUNT_MAX)
        self.assertTrue(skills, "Shared skill collection is empty")
        for skill in skills:
            with self.subTest(skill=skill.name):
                self.assertFalse(skill.is_symlink(), "Shared originals must not be client aliases")
                self.assertTrue((skill / "SKILL.md").is_file())
                for client in [CONFIGURATION_ROOT.parent / ".pi/agent/skills", CONFIGURATION_ROOT.parent / ".config/opencode/skills"]:
                    link = client / skill.name
                    self.assertTrue(link.is_symlink(), f"Missing shared link: {link}")
                    self.assertTrue(link.samefile(skill), f"Client uses a different skill copy: {link}")

    def test_generated_instruction_files_match_sources(self):
        for target, expected in BUILD.render_outputs(CONFIGURATION_ROOT):
            with self.subTest(target=str(target)):
                self.assertEqual(target.read_bytes(), expected)
        for target in [CONFIGURATION_ROOT.parent / ".pi/agent/SYSTEM.md", CONFIGURATION_ROOT.parent / ".config/opencode/AGENTS.md"]:
            content = target.read_text()
            self.assertEqual(content.count("## Review Before Committing\n"), 1)
            self.assertEqual(content.count("## Communication Principles\n"), 1)

    def test_pi_protocols_are_not_exposed_to_opencode(self):
        for name in ["docket", "subagent"]:
            self.assertTrue((CONFIGURATION_ROOT.parent / ".pi/agent/skills" / name / "SKILL.md").is_file())
            self.assertFalse((CONFIGURATION_ROOT / "shared/skills" / name).exists())
            self.assertFalse((CONFIGURATION_ROOT.parent / ".config/opencode/skills" / name).exists())

    def test_dashboard_originals_and_browser_executables_remain_available(self):
        images = CONFIGURATION_ROOT / "shared/skills/design/references/dashboard/images"
        originals = list(islice(images.glob("*.png"), DASHBOARD_IMAGES_COUNT + 1))
        self.assertEqual(len(originals), DASHBOARD_IMAGES_COUNT)
        for image in originals:
            with image.open("rb") as stream:
                self.assertEqual(stream.read(8), b"\x89PNG\r\n\x1a\n")
        templates = CONFIGURATION_ROOT / "shared/skills/agent-browser/templates"
        scripts = list(islice(templates.glob("*.sh"), DIRECTORY_COUNT_MAX + 1))
        self.assertTrue(scripts)
        self.assertLessEqual(len(scripts), DIRECTORY_COUNT_MAX)
        for script in scripts:
            self.assertTrue(script.stat().st_mode & 0o100, f"Browser template lost owner execution: {script.name}")


if __name__ == "__main__":
    unittest.main()
