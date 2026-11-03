import importlib.util
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
        self.root = Path(self.temporary.name) / ".ai"
        for name, content in [("shared", "## Common rules\nReview before committing.\n"), ("pi", "# Pi workspace\nPi only.\n"), ("opencode", "# OpenCode runtime\nOpenCode only.\n")]:
            directory = self.root / name
            directory.mkdir(parents=True)
            (directory / "AGENTS.md").write_text(content)

    def snapshot(self):
        return {target: (target.read_bytes(), target.stat().st_mode) for target, _ in BUILD.render_outputs(self.root)}

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
        (self.root / "pi/AGENTS.md").write_text("Changed workspace")
        write_atomic = BUILD.write_atomic
        target_failure = self.root.parent / ".pi/AGENTS.md"

        def fail_second_target(target, content, mode):
            if target == target_failure:
                raise OSError("Injected second-output write failure")
            write_atomic(target, content, mode)

        with mock.patch.object(BUILD, "write_atomic", side_effect=fail_second_target):
            with self.assertRaisesRegex(OSError, "Injected"):
                BUILD.build(self.root)
        self.assertEqual(self.snapshot(), before)

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
