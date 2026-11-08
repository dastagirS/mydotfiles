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
                for client in [Path.home() / ".pi/agent/skills", Path.home() / ".config/opencode/skills"]:
                    link = client / skill.name
                    self.assertTrue(link.is_symlink(), f"Missing shared link: {link}")
                    self.assertFalse(link.readlink().is_absolute(), f"Managed link is not portable: {link}")
                    self.assertTrue(link.samefile(skill), f"Client uses a different skill copy: {link}")

    def test_opencode_has_only_the_shared_pi_skill_set(self):
        shared = list(islice((CONFIGURATION_ROOT / "shared/skills").iterdir(), DIRECTORY_COUNT_MAX + 1))
        installed = list(islice((Path.home() / ".config/opencode/skills").iterdir(), DIRECTORY_COUNT_MAX + 1))
        self.assertLessEqual(len(shared), DIRECTORY_COUNT_MAX)
        self.assertLessEqual(len(installed), DIRECTORY_COUNT_MAX)
        self.assertEqual({path.name for path in installed}, {path.name for path in shared})
        for name in ["spec-builder", "spec-planner", "ponytail-review"]:
            self.assertFalse((Path.home() / ".config/opencode/tmp" / name / "SKILL.md").exists())
            self.assertFalse((Path.home() / ".config/opencode/command" / (name + ".md")).exists())

    def test_pi_workspace_uses_the_canonical_document(self):
        workspace = Path.home() / ".pi/AGENTS.md"
        self.assertTrue(workspace.is_symlink())
        self.assertFalse(workspace.readlink().is_absolute())
        self.assertTrue(workspace.samefile(CONFIGURATION_ROOT / "pi/AGENTS.md"))

    def test_generated_instruction_files_match_sources(self):
        for target, expected in BUILD.render_outputs(CONFIGURATION_ROOT):
            with self.subTest(target=str(target)):
                self.assertEqual(target.read_bytes(), expected)
        for target in [Path.home() / ".pi/agent/SYSTEM.md", Path.home() / ".config/opencode/AGENTS.md"]:
            content = target.read_text()
            self.assertEqual(content.count("## Review Before Committing\n"), 1)
            self.assertEqual(content.count("## Communication Principles\n"), 1)

    def test_pi_protocols_are_not_exposed_to_opencode(self):
        for name in ["docket", "subagent"]:
            self.assertTrue((Path.home() / ".pi/agent/skills" / name / "SKILL.md").is_file())
            self.assertFalse((CONFIGURATION_ROOT / "shared/skills" / name).exists())
            self.assertFalse((Path.home() / ".config/opencode/skills" / name).exists())

    def test_generic_browser_skill_replaces_the_vendored_cli_skill(self):
        self.assertTrue((CONFIGURATION_ROOT / "shared/skills/browser/SKILL.md").is_file())
        for root in [CONFIGURATION_ROOT / "shared/skills", Path.home() / ".pi/agent/skills", Path.home() / ".config/opencode/skills"]:
            self.assertFalse((root / "agent-browser").exists())
            self.assertFalse((root / "agent-browser").is_symlink())

    def test_dashboard_originals_remain_available(self):
        images = CONFIGURATION_ROOT / "shared/skills/design/references/dashboard/images"
        originals = list(islice(images.glob("*.png"), DASHBOARD_IMAGES_COUNT + 1))
        self.assertEqual(len(originals), DASHBOARD_IMAGES_COUNT)
        for image in originals:
            with image.open("rb") as stream:
                self.assertEqual(stream.read(8), b"\x89PNG\r\n\x1a\n")


if __name__ == "__main__":
    unittest.main()
