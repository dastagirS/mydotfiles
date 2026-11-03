import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SPECIFICATION = importlib.util.spec_from_file_location("shared_instruction_build", Path(__file__).with_name("build.py"))
BUILD = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(BUILD)


class InstructionBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ai-build-test-")
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name) / "home"
        self.root = self.home / ".ai"
        home_patch = mock.patch.object(BUILD.Path, "home", return_value=self.home)
        self.home_lookup = home_patch.start()
        self.addCleanup(home_patch.stop)
        for name, content in [("shared", "## Common rules\nReview before committing.\n"), ("pi", "# Pi workspace\nPi only.\n"), ("opencode", "# OpenCode runtime\nOpenCode only.\n")]:
            directory = self.root / name
            directory.mkdir(parents=True)
            (directory / "AGENTS.md").write_text(content)
        workspace = self.root.parent / ".pi/AGENTS.md"
        workspace.parent.mkdir(parents=True)
        workspace.symlink_to(self.root / "pi/AGENTS.md")

    def snapshot(self):
        return {target: (target.read_bytes(), target.stat().st_mode) for target, _ in BUILD.render_outputs(self.root)}

    def test_generated_headers_do_not_embed_the_source_location(self):
        for target, content in BUILD.render_outputs(self.root):
            self.assertNotIn(str(self.root).encode(), content)

    def test_outputs_follow_home_not_the_source_parent(self):
        other = Path(self.temporary.name) / "source-checkout/configuration"
        for name in ["shared", "opencode"]:
            (other / name).mkdir(parents=True)
            (other / name / "AGENTS.md").write_bytes((self.root / name / "AGENTS.md").read_bytes())
        with mock.patch.object(BUILD.Path, "home", return_value=self.root.parent):
            targets = [target for target, _ in BUILD.render_outputs(other)]
        self.assertEqual(targets, [self.root.parent / ".pi/agent/SYSTEM.md", self.root.parent / ".config/opencode/AGENTS.md"])

    def test_client_rules_are_composed_without_runtime_leakage(self):
        BUILD.build(self.root)
        system = (self.root.parent / ".pi/agent/SYSTEM.md").read_text()
        workspace = (self.root.parent / ".pi/AGENTS.md").read_text()
        opencode = (self.root.parent / ".config/opencode/AGENTS.md").read_text()
        self.assertEqual(system.count("## Common rules"), 1)
        self.assertEqual(opencode.count("## Common rules"), 1)
        self.assertNotIn("OpenCode only", system)
        self.assertNotIn("Pi only", opencode)
        self.assertIn("Pi only", workspace)
        self.assertNotIn("## Common rules", workspace)

    def test_pi_workspace_link_survives_build_and_reads_source_edits(self):
        workspace = self.root.parent / ".pi/AGENTS.md"
        source = self.root / "pi/AGENTS.md"
        BUILD.build(self.root)
        self.assertTrue(workspace.is_symlink())
        self.assertTrue(workspace.samefile(source))
        source.write_text("# Pi workspace\nUpdated without rebuilding.\n")
        self.assertEqual(workspace.read_text(), source.read_text())
        BUILD.build(self.root, check=True)
        BUILD.build(self.root)
        self.assertTrue(workspace.is_symlink())
        self.assertTrue(workspace.samefile(source))

    def test_unchanged_build_and_check_do_not_rewrite_files(self):
        BUILD.build(self.root)
        before = self.snapshot()
        with mock.patch.object(BUILD.os, "replace", side_effect=AssertionError("Unexpected rewrite")):
            BUILD.build(self.root)
            BUILD.build(self.root, check=True)
        self.assertEqual(self.snapshot(), before)

    def test_stale_check_is_read_only_and_rebuild_propagates_shared_edit(self):
        BUILD.build(self.root)
        before = self.snapshot()
        (self.root / "shared/AGENTS.md").write_text("## Common rules\nUpdated policy.\n")
        with self.assertRaisesRegex(ValueError, "stale"):
            BUILD.build(self.root, check=True)
        self.assertEqual(self.snapshot(), before)
        BUILD.build(self.root)
        for target, content in BUILD.render_outputs(self.root):
            self.assertEqual(target.read_bytes(), content)
        self.assertIn("Updated policy", (self.root.parent / ".pi/agent/SYSTEM.md").read_text())
        self.assertIn("Updated policy", (self.root.parent / ".config/opencode/AGENTS.md").read_text())

    def test_invalid_source_fails_before_any_target_changes(self):
        BUILD.build(self.root)
        before = self.snapshot()
        source = self.root / "opencode/AGENTS.md"
        for invalid in [b"\xff", b"\0", b"x" * (BUILD.TEXT_BYTES_MAX + 1), b"  "]:
            with self.subTest(invalid_size=len(invalid)):
                source.write_bytes(invalid)
                with self.assertRaises((UnicodeError, ValueError)):
                    BUILD.build(self.root)
                for target, (content, mode) in before.items():
                    self.assertEqual(target.read_bytes(), content)
                    self.assertEqual(target.stat().st_mode, mode)

    def test_symlink_target_is_not_overwritten(self):
        BUILD.build(self.root)
        target = self.root.parent / ".config/opencode/AGENTS.md"
        foreign = self.root.parent / "foreign.md"
        foreign.write_text("Not managed")
        target.unlink()
        target.symlink_to(foreign)
        with self.assertRaisesRegex(ValueError, "symlink"):
            BUILD.build(self.root)
        self.assertEqual(foreign.read_text(), "Not managed")
        self.assertTrue(target.is_symlink())

    def test_write_failure_restores_previous_contents_and_permissions(self):
        BUILD.build(self.root)
        system = self.root.parent / ".pi/agent/SYSTEM.md"
        system.chmod(0o640)
        before = self.snapshot()
        (self.root / "shared/AGENTS.md").write_text("Changed common policy")
        write_atomic = BUILD.write_atomic
        target_failure = self.root.parent / ".config/opencode/AGENTS.md"

        def fail_second_target(target, content, mode):
            if target == target_failure:
                raise OSError("Injected second-output write failure")
            write_atomic(target, content, mode)

        with mock.patch.object(BUILD, "write_atomic", side_effect=fail_second_target):
            with self.assertRaisesRegex(OSError, "Injected"):
                BUILD.build(self.root)
        self.assertEqual(self.snapshot(), before)

    def add_shared_skill(self):
        skill = self.root / "shared/skills/example"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("Example skill")
        return skill

    def test_relative_links_survive_moving_the_home_directory(self):
        self.add_shared_skill()
        BUILD.build(self.root)
        BUILD.install_links(BUILD.plan_links(self.root))
        moved = Path(self.temporary.name) / "another-user"
        self.home.rename(moved)
        self.home_lookup.return_value = moved
        root = moved / ".ai"
        for link, source in [(moved / ".pi/AGENTS.md", root / "pi/AGENTS.md"), (moved / ".pi/agent/skills/example", root / "shared/skills/example"), (moved / ".config/opencode/skills/example", root / "shared/skills/example")]:
            self.assertFalse(link.readlink().is_absolute())
            self.assertTrue(link.samefile(source))
        self.assertEqual(BUILD.plan_links(root), [])
        BUILD.build(root, check=True)

    def test_link_check_is_read_only(self):
        self.add_shared_skill()
        workspace = self.home / ".pi/AGENTS.md"
        previous = workspace.readlink()
        with self.assertRaisesRegex(ValueError, "not relative"):
            BUILD.install_links(BUILD.plan_links(self.root), check=True)
        self.assertEqual(workspace.readlink(), previous)
        self.assertFalse((self.home / ".config/opencode/skills/example").exists())

    def test_unrelated_links_and_real_directories_are_never_replaced(self):
        self.add_shared_skill()
        link = self.home / ".config/opencode/skills/example"
        link.parent.mkdir(parents=True)
        foreign = self.home / "other-skill"
        foreign.mkdir()
        link.symlink_to(foreign)
        with self.assertRaisesRegex(ValueError, "unrelated"):
            BUILD.plan_links(self.root)
        self.assertTrue(link.samefile(foreign))
        link.unlink()
        link.mkdir()
        (link / "keep.txt").write_text("Unmanaged data")
        with self.assertRaisesRegex(ValueError, "non-symlink"):
            BUILD.plan_links(self.root)
        self.assertEqual((link / "keep.txt").read_text(), "Unmanaged data")

    def test_link_failure_restores_previous_targets(self):
        self.add_shared_skill()
        workspace = self.home / ".pi/AGENTS.md"
        previous = workspace.readlink()
        changes = BUILD.plan_links(self.root)
        replace_link = BUILD.replace_link
        target_failure = self.home / ".config/opencode/skills/example"

        def fail_last_target(link, target):
            if link == target_failure:
                raise OSError("Injected link replacement failure")
            replace_link(link, target)

        with mock.patch.object(BUILD, "replace_link", side_effect=fail_last_target):
            with self.assertRaisesRegex(OSError, "Injected"):
                BUILD.install_links(changes)
        self.assertEqual(workspace.readlink(), previous)
        self.assertFalse((self.home / ".pi/agent/skills/example").is_symlink())
        self.assertFalse(target_failure.is_symlink())

    def test_link_changed_after_planning_is_not_clobbered(self):
        self.add_shared_skill()
        changes = BUILD.plan_links(self.root)
        workspace = self.home / ".pi/AGENTS.md"
        workspace.unlink()
        workspace.write_text("A concurrent manual edit")
        with self.assertRaisesRegex(ValueError, "changed"):
            BUILD.install_links(changes)
        self.assertEqual(workspace.read_text(), "A concurrent manual edit")

    def test_cli_uses_its_location_and_the_environment_home(self):
        self.add_shared_skill()
        shutil.copyfile(BUILD.__file__, self.root / "build.py")
        environment = {"HOME": str(self.home), "PATH": os.environ["PATH"]}
        for flags in [["--links"], ["--links", "--check"]]:
            result = subprocess.run([sys.executable, str(self.root / "build.py"), *flags], env=environment, capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.home / ".pi/agent/skills/example").samefile(self.root / "shared/skills/example"))
        self.assertFalse((self.home / ".pi/AGENTS.md").readlink().is_absolute())

    def test_atomic_replace_failure_leaves_no_temporary_file(self):
        directory = self.root / "shared"
        target = directory / "AGENTS.md"
        before = target.read_bytes()
        with mock.patch.object(BUILD.os, "replace", side_effect=OSError("Injected replace failure")):
            with self.assertRaisesRegex(OSError, "Injected"):
                BUILD.write_atomic(target, b"replacement", 0o600)
        self.assertEqual(target.read_bytes(), before)
        self.assertEqual(sorted(path.name for path in directory.iterdir()), ["AGENTS.md"])


if __name__ == "__main__":
    unittest.main()
