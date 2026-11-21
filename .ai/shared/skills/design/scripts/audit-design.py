#!/usr/bin/env python3
"""Check delivered HTML/CSS against the design scale.

Deterministic half of the design skill: token tables, motion rules, and the
placeholder markers that are easy to leave behind. Judgment rules (purpose,
structure, hierarchy) stay with the agent.

Usage:
    python3 scripts/audit-design.py page.html styles.css
    python3 scripts/audit-design.py ./dist          # every .html/.css below it

Exit codes: 0 clean, 1 findings, 2 unreadable input.
"""

import argparse
import os
import re
import sys

# Token tables from SKILL.md. A value outside them is a typo, not a choice.
FONT_SIZE_STEPS = {12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96, 128}
SPACING_STEPS = {0, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96}
RADIUS_STEPS = {0, 2, 4, 6, 8, 12, 16, 24, 9999}

BANNED_FAMILIES = ('inter', 'roboto', 'arial', 'open sans', 'helvetica')
BANNED_EASINGS = ('ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear')
BANNED_TRANSITION_PROPS = ('top', 'left', 'right', 'bottom', 'width', 'height', 'margin', 'padding')

PLACEHOLDER_MARKERS = ('lorem ipsum', 'your headline', 'your text here', 'placeholder text', 'todo:')

SCAN_SUFFIXES = ('.html', '.htm', '.css')
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_FINDINGS = 300

CSS_DECLARATION = re.compile(r'(?P<property>[a-z-]+)\s*:\s*(?P<value>[^;{}]+)')
CSS_COMMENT = re.compile(r'/\*.*?\*/', re.S)
PX_VALUE = re.compile(r'(?<![\d.])(\d+(?:\.\d+)?)px')
FONT_FAMILY_DECLARATION = re.compile(r'font-family\s*:\s*([^;{}]+)')
IMG_TAG = re.compile(r'<img\b[^>]*>', re.IGNORECASE)
ALT_ATTRIBUTE = re.compile(r'\balt\s*=', re.IGNORECASE)
DEAD_HREF = re.compile(r'href\s*=\s*["\']#["\']')


class Report:
    def __init__(self):
        self.findings = []

    def add(self, level, path, line, rule, detail):
        if len(self.findings) >= MAX_FINDINGS:
            return
        self.findings.append((level, path, line, rule, detail))

    def truncated(self):
        return len(self.findings) >= MAX_FINDINGS


def line_of(text, offset):
    return text.count('\n', 0, offset) + 1


def px_values(value):
    """Plain px literals in a declaration value, skipping calc()/var()/clamp()."""
    if 'calc(' in value or 'var(' in value or 'clamp(' in value:
        return []
    return [float(match) for match in PX_VALUE.findall(value)]


def check_declaration(report, path, text, offset, property_name, value):
    line = line_of(text, offset)

    if property_name == 'font-size':
        for px in px_values(value):
            if px not in FONT_SIZE_STEPS:
                report.add('warn', path, line, 'font-size off scale',
                           f'{px:g}px is not a step ({sorted(FONT_SIZE_STEPS)})')

    if property_name == 'border-radius':
        for px in px_values(value):
            if px not in RADIUS_STEPS:
                report.add('warn', path, line, 'radius off scale',
                           f'{px:g}px is not a step ({sorted(RADIUS_STEPS)})')

    if property_name in ('margin', 'padding', 'gap', 'row-gap', 'column-gap') or \
            property_name.startswith(('margin-', 'padding-')):
        for px in px_values(value):
            if px not in SPACING_STEPS:
                report.add('warn', path, line, 'spacing off scale',
                           f'{px:g}px is not a step ({sorted(SPACING_STEPS)})')

    if property_name in ('transition-timing-function', 'animation-timing-function'):
        for easing in value.split(','):
            keyword = easing.strip()
            if keyword in BANNED_EASINGS:
                report.add('error', path, line, 'banned easing',
                           f'{keyword} is out; use cubic-bezier(0.22, 1, 0.36, 1)')

    if property_name == 'transition-property':
        for candidate in value.split(','):
            if candidate.strip() in BANNED_TRANSITION_PROPS:
                report.add('error', path, line, 'layout-animating property',
                           f'{candidate.strip()} is out; animate transform and opacity')

    if property_name in ('transition', 'animation'):
        for candidate in value.split(','):
            # Split on parentheses too, so cubic-bezier(0.22, 1, 0.36, 1) never
            # contributes the word "linear" from a neighbouring shorthand.
            words = candidate.replace('(', ' ').replace(')', ' ').split()
            for prop in BANNED_TRANSITION_PROPS:
                if prop in words:
                    report.add('error', path, line, 'layout-animating property',
                               f'{prop} is out; animate transform and opacity')
            for easing in BANNED_EASINGS:
                if easing in words:
                    report.add('error', path, line, 'banned easing',
                               f'{easing} is out; use cubic-bezier(0.22, 1, 0.36, 1)')

    if property_name == 'font-style' and value.strip() in ('italic', 'oblique'):
        report.add('error', path, line, 'italic', 'typeface is upright only')

    if property_name == 'font-weight':
        weight = value.strip()
        if weight.isdigit() and int(weight) >= 900:
            report.add('error', path, line, 'overweight', f'{weight} is above the bold cap')


def strip_comments(text):
    """Blank out /* */ comments, keeping every newline so line numbers stay true.

    A commented-out declaration must not be reported as if it were live CSS.
    """
    return CSS_COMMENT.sub(lambda match: '\n' * match.group(0).count('\n'), text)


def check_css(report, path, text):
    text = strip_comments(text)
    for match in CSS_DECLARATION.finditer(text):
        check_declaration(report, path, text, match.start(), match.group('property'), match.group('value'))

    for match in FONT_FAMILY_DECLARATION.finditer(text):
        families = match.group(1).lower()
        for banned in BANNED_FAMILIES:
            if re.search(r'\b' + re.escape(banned) + r'\b', families):
                report.add('error', path, line_of(text, match.start()), 'banned typeface',
                           f'{banned} is out; choose a face from the subject')

    # A file that moves or transitions anything must offer the reduced-motion branch.
    if ('transition' in text or '@keyframes' in text) and 'prefers-reduced-motion' not in text:
        report.add('warn', path, 1, 'no reduced-motion branch',
                   'the file animates but never honours prefers-reduced-motion')


def check_html(report, path, text):
    lower = text.lower()
    for marker in PLACEHOLDER_MARKERS:
        start = 0
        while True:
            found = lower.find(marker, start)
            if found < 0:
                break
            report.add('error', path, line_of(text, found), 'placeholder copy', f'found "{marker}"')
            start = found + len(marker)

    for match in DEAD_HREF.finditer(text):
        report.add('error', path, line_of(text, match.start()), 'dead link', 'href="#" goes nowhere')

    for match in IMG_TAG.finditer(text):
        if not ALT_ATTRIBUTE.search(match.group(0)):
            report.add('error', path, line_of(text, match.start()), 'image without alt',
                       match.group(0)[:60])

    if '<html' in lower and not re.search(r'<title>[^<]+</title>', text, re.IGNORECASE):
        report.add('warn', path, 1, 'missing title', 'document has no non-empty <title>')


def collect_files(targets):
    files = []
    missing = []
    for target in targets:
        if os.path.isdir(target):
            for root, directories, names in os.walk(target):
                directories[:] = [name for name in sorted(directories)
                                  if name not in ('.git', 'node_modules')]
                for name in sorted(names):
                    if name.endswith(SCAN_SUFFIXES):
                        files.append(os.path.join(root, name))
        elif os.path.exists(target):
            files.append(target)
        else:
            missing.append(target)
    return files, missing


def main(argv):
    parser = argparse.ArgumentParser(description='Audit delivered HTML and CSS against the design scale.')
    parser.add_argument('targets', nargs='+', help='files or directories to scan')
    parser.add_argument('--warn', action='store_true', help='treat warnings as failures too')
    arguments = parser.parse_args(argv)

    report = Report()
    files, missing = collect_files(arguments.targets)
    for target in missing:
        print(f'no such file or directory: {target}', file=sys.stderr)
    if missing:
        return 2
    if not files:
        print('no .html or .css files found', file=sys.stderr)
        return 2

    skipped = []
    for path in files:
        try:
            if os.path.getsize(path) > MAX_FILE_BYTES:
                skipped.append((path, 'larger than 4 MB'))
                continue
            with open(path, 'r', encoding='utf-8', errors='replace') as handle:
                text = handle.read()
        except OSError as error:
            print(f'cannot read {path}: {error.strerror}', file=sys.stderr)
            return 2

        if path.endswith(('.css',)):
            check_css(report, path, text)
        else:
            check_html(report, path, text)

    errors = [f for f in report.findings if f[0] == 'error']
    warnings = [f for f in report.findings if f[0] == 'warn']

    # Group by file and line: the first finding in a file is the one being edited.
    for level, path, line, rule, detail in sorted(report.findings, key=lambda f: (f[1], f[2], f[3])):
        print(f'{path}:{line}: {level}: {rule}: {detail}')
    for path, reason in skipped:
        print(f'{path}: skipped: {reason}')
    if report.truncated():
        print(f'... stopped at {MAX_FINDINGS} findings; fix these, then rerun')

    print(f'\n{len(files)} files, {len(errors)} errors, {len(warnings)} warnings')
    if errors or (arguments.warn and warnings):
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
