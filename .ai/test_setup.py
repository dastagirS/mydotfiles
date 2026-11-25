import importlib.util
from itertools import islice
from pathlib import Path
import re
import unittest

CONFIGURATION_ROOT = Path(__file__).resolve().parent
DIRECTORY_COUNT_MAX = 64
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

    def test_design_skill_files_are_current(self):
        skill = CONFIGURATION_ROOT / "shared/skills/design"
        for relative in [
            "SKILL.md",
            "references/DESIGN-REFERENCES.md",
            "scripts/audit-design.py",
            "LICENSE",
            "SOURCES.md",
        ]:
            with self.subTest(path=relative):
                self.assertTrue((skill / relative).is_file())
        self.assertFalse((skill / "references/DESIGN-RESEARCH.md").exists())
        self.assertFalse((skill / "references/web-inspiration.md").exists())
        self.assertFalse((skill / "references/dashboard").exists())
        self.assertFalse((skill / "assets").exists())

    def test_design_reference_links_resolve(self):
        skill = CONFIGURATION_ROOT / "shared/skills/design"
        for document in [skill / "SKILL.md", skill / "SOURCES.md", *sorted((skill / "references").glob("*.md"))]:
            for target in re.findall(r"\]\(([^)]+)\)", document.read_text()):
                if target.startswith(("http://", "https://")):
                    continue
                path = target.split("#", 1)[0]
                if not path:
                    continue
                with self.subTest(document=document.name, target=target):
                    self.assertTrue((document.parent / path).resolve().exists())

    def test_design_research_requires_artifacts_and_browser(self):
        skill = CONFIGURATION_ROOT / "shared/skills/design"
        main = (skill / "SKILL.md").read_text()
        references = (skill / "references/DESIGN-REFERENCES.md").read_text()
        self.assertIn("A reference artifact is one individual thing", references)
        self.assertIn("is **not** a reference artifact", references)
        self.assertIn("| Full page or site | 3 |", references)
        # The gate moved into the reference: the agent checks what browser it
        # has, and asks the user before driving the one installed locally.
        self.assertIn("[browser gate](references/DESIGN-REFERENCES.md#browser-gate)", main)
        self.assertIn("may i drive the browser installed on this machine", references.lower())
        self.assertIn("in an isolated session", references)
        self.assertIn("| `search({ query, tags, limit, cursor })` |", references)
        # Frame extraction is gated on the tool being present: no silent ffmpeg.
        self.assertIn("`ffmpeg -version`", references)
        self.assertIn("ask the user to install `ffmpeg`", references)
        self.assertIn("Installing is the user's call, not yours", references)
        self.assertIn("## From scratch", main)
        # Every reference is announced with when to read it, and the depth files
        # exist where SKILL.md sends the agent.
        for name in ("SURFACES", "COMPOSITION", "COMPONENTS", "COLOUR-AND-TYPE", "ACCESSIBILITY", "PERFORMANCE"):
            self.assertIn(f"references/{name}.md](references/{name}.md)", main)
            self.assertTrue((skill / f"references/{name}.md").is_file())
        self.assertIn("**A live HTML preview** of the actual design.", main)
        self.assertIn("A tweak to an existing surface runs steps 2 and 5 only", main)
        self.assertIn("when researching design references", main)
        self.assertIn("candidate queue", main)
        self.assertIn("**Do not return after one blocked candidate.**", main)
        self.assertIn("## Research budget", references)
        self.assertIn("| Candidate opens | 8 |", references)
        self.assertIn("**Blocked:** record it, open the next candidate.", references)
        self.assertIn("Never:** report done with accepted below the bar", references)


if __name__ == "__main__":
    unittest.main()
