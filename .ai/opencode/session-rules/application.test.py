"""Isolated OpenCode 2 lifecycle check; scripted loopback provider, never a real model."""
import base64
import json
import os
from pathlib import Path
import secrets
import select
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SOURCE = Path(__file__).resolve().parent
REQUESTS_MAX = 64
BODY_BYTES_MAX = 2 * 1024 * 1024
OPERATION_SECONDS_MAX = 20
TOTAL_SECONDS_MAX = 120
RULE_TEXT = 'Keep corrections session-local.\n'.ljust(160, '😀')
SUMMARY = '## Objective\n- SCRIPTED_OPENCODE_COMPACTION_SUMMARY: isolated rule lifecycle.\n\n## Requirements\n- Session-local rules.\n\n## Decisions\n- Use native plugin storage.\n\n## Work State\n### Completed\n- Added test rule.\n### Active\n- Lifecycle checks.\n### Blocked\n- (none)\n\n## Next Move\n1. Continue isolated checks.\n\n## Relevant Files\n- (none)\n\n## Important Context\n- Scripted fixture only.'


class ApplicationTest(unittest.TestCase):
    def test_native_lifecycle(self):
        started = time.monotonic()
        captured = []
        errors = []
        cursors = {}
        rule_id = None
        process = None
        authorization = None
        server_url = None
        case = self

        def text(content):
            if isinstance(content, str):
                return content
            return ''.join(part.get('text', '') for part in content or [])

        class Provider(BaseHTTPRequestHandler):
            def log_message(self, *_arguments):
                pass

            def do_POST(self):
                nonlocal rule_id
                try:
                    self.connection.settimeout(OPERATION_SECONDS_MAX)
                    case.assertEqual(self.path, '/v1/chat/completions')
                    case.assertLess(len(captured), REQUESTS_MAX)
                    size = int(self.headers.get('Content-Length', '0'))
                    case.assertTrue(0 < size <= BODY_BYTES_MAX)
                    body = json.loads(self.rfile.read(size))
                    captured.append(body)
                    tools = [tool.get('function', tool)['name'] for tool in body.get('tools', [])]
                    call = None
                    content = SUMMARY
                    phase = text(next(message for message in reversed(body['messages']) if message['role'] == 'user')['content'])
                    compacting = 'Return only the structured summary in the requested format.' in phase
                    if not compacting:
                        case.assertIn('session_rules', tools)
                        system = '\n'.join(text(message.get('content')) for message in body['messages'] if message['role'] == 'system')
                        case.assertIn('PROJECT_INSTRUCTIONS_UNCHANGED', system)
                        cursor = cursors.get(phase, 0)
                        cursors[phase] = cursor + 1
                        case.assertLess(cursor, 5)
                        active = (cursor >= 2 if phase == 'ADD' else cursor == 0 if phase == 'REMOVE'
                                  else phase in ['DUPLICATE', 'INVALID', 'RELOAD', 'COMPACTED', 'RESUMED', 'REUSED_ID'])
                        case.assertEqual(json.dumps(RULE_TEXT, ensure_ascii=False) in system, active, (phase, cursor))
                        case.assertEqual(system.count('Current-session correction rules (not global policy'), 1)
                        plans = {
                            'ADD': [{'action': 'list'}, {'action': 'add', 'text': RULE_TEXT}, {'action': 'list'}],
                            'DUPLICATE': [{'action': 'add', 'text': RULE_TEXT}],
                            'INVALID': [{'action': 'add', 'text': 'x' * 161}],
                            'REMOVE': [{'action': 'remove', 'id': rule_id}, {'action': 'list'}],
                        }
                        plan = plans.get(phase, [{'action': 'list'}])
                        if cursor:
                            previous = plan[cursor - 1]
                            result_text = text(body['messages'][-1]['content'])
                            case.assertEqual(body['messages'][-1]['role'], 'tool')
                            if phase == 'DUPLICATE':
                                case.assertIn('duplicate', result_text)
                            elif phase == 'INVALID':
                                case.assertIn('160', result_text)
                            else:
                                result = json.loads(result_text)
                                if previous['action'] == 'add':
                                    case.assertEqual(result['added']['text'], RULE_TEXT)
                                    rule_id = result['added']['id']
                                elif previous['action'] == 'remove':
                                    case.assertEqual(result['removed'], rule_id)
                                else:
                                    case.assertEqual(result['total'], 1 if active else 0)
                                    case.assertEqual(result['rules'], [{'id': rule_id, 'text': RULE_TEXT}] if active else [])
                        if cursor < len(plan):
                            call = {'name': 'session_rules', 'arguments': json.dumps(plan[cursor])}
                        content = 'Completed ' + phase
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/event-stream')
                    self.end_headers()
                    delta = {'role': 'assistant', 'content': content} if call is None else {
                        'role': 'assistant', 'tool_calls': [{'index': 0, 'id': 'fixture-' + str(len(captured)), 'type': 'function', 'function': call}]}
                    chunks = [
                        {'id': 'fixture', 'object': 'chat.completion.chunk', 'model': 'fixture', 'choices': [{'index': 0, 'delta': delta, 'finish_reason': None}]},
                        {'id': 'fixture', 'object': 'chat.completion.chunk', 'model': 'fixture', 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls' if call else 'stop'}],
                         'usage': {'prompt_tokens': 100, 'completion_tokens': 20, 'total_tokens': 120}},
                    ]
                    for chunk in chunks:
                        self.wfile.write(('data: ' + json.dumps(chunk) + '\n\n').encode())
                    self.wfile.write(b'data: [DONE]\n\n')
                    self.wfile.flush()
                except Exception as error:
                    errors.append(str(error))
                    if not self.wfile.closed:
                        try:
                            self.send_error(500, 'Fixture assertion failed')
                        except (BrokenPipeError, ConnectionResetError):
                            pass

        with tempfile.TemporaryDirectory(prefix='opencode-session-rules-') as temporary:
            root = Path(temporary)
            for name in ['home', 'config', 'data', 'state', 'cache', 'project']:
                (root / name).mkdir()
            canonical = root / 'canonical/session-rules'
            canonical.mkdir(parents=True)
            for name in ['index.js', 'package.json']:
                shutil.copyfile(SOURCE / name, canonical / name)
            plugin = root / 'config/plugins/session-rules'
            plugin.parent.mkdir(parents=True)
            plugin.symlink_to(os.path.relpath(canonical, plugin.parent), target_is_directory=True)
            self.assertEqual(plugin.resolve(), canonical)
            instructions = root / 'project/AGENTS.md'
            instructions.write_text('PROJECT_INSTRUCTIONS_UNCHANGED: retain normal project instructions.\n')
            original_instructions = instructions.read_bytes()
            provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
            provider.daemon_threads = True
            provider_thread = threading.Thread(target=provider.serve_forever, daemon=True)
            provider_thread.start()
            settings = {
                'plugins': [],
                'providers': {'rules-fixture': {
                    'package': '@opencode/ai/providers/openai-compatible',
                    'settings': {'baseURL': f'http://127.0.0.1:{provider.server_port}/v1', 'apiKey': 'public-local-fixture', 'transport': 'http'},
                    'models': {'fixture': {'capabilities': {'tools': True, 'input': ['text'], 'output': ['text']},
                                           'limit': {'context': 32000, 'output': 1024}, 'cost': {'input': 0, 'output': 0}}},
                }},
                'model': {'providerID': 'rules-fixture', 'model': 'fixture'},
            }
            (root / 'config/opencode.jsonc').write_text(json.dumps(settings))

            def request(method, route, data=None):
                case.assertLess(time.monotonic() - started, TOTAL_SECONDS_MAX)
                headers = {'Authorization': authorization, 'Content-Type': 'application/json'}
                body = json.dumps(data).encode() if data is not None else None
                try:
                    with urllib.request.urlopen(urllib.request.Request(server_url + route, data=body, headers=headers, method=method), timeout=OPERATION_SECONDS_MAX) as response:
                        encoded = response.read(BODY_BYTES_MAX + 1)
                        case.assertLessEqual(len(encoded), BODY_BYTES_MAX)
                        return json.loads(encoded) if encoded else None
                except urllib.error.HTTPError as error:
                    raise AssertionError(f'{method} {route}: {error.code}: {error.read(2000).decode()}') from None
                except TimeoutError:
                    raise AssertionError(f'Isolated API timeout; provider assertions: {errors[:3]}; requests: {len(captured)}') from None

            def wait_plugin():
                for _ in range(60):
                    plugins = request('GET', '/api/plugin')['data']
                    matches = [item for item in plugins if item.get('id') == 'local.session-rules']
                    if matches:
                        case.assertEqual(matches[0]['state']['status'], 'active', matches[0]['state'])
                        return
                    time.sleep(0.05)
                case.fail('Session-rule plugin did not activate in isolated profile')

            def stop():
                nonlocal process
                if process is None:
                    return
                process.stdin.close()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
                finally:
                    process.stdout.close()
                    process = None

            def start():
                nonlocal process, authorization, server_url
                password = secrets.token_urlsafe(24)
                authorization = 'Basic ' + base64.b64encode(('opencode:' + password).encode()).decode()
                environment = {
                    'PATH': os.environ['PATH'], 'HOME': str(root / 'home'), 'XDG_CONFIG_HOME': str(root / 'config'),
                    'XDG_DATA_HOME': str(root / 'data'), 'XDG_STATE_HOME': str(root / 'state'), 'XDG_CACHE_HOME': str(root / 'cache'),
                    'OPENCODE_CONFIG_DIR': str(root / 'config'), 'OPENCODE_SERVER_PASSWORD': password,
                    'OPENCODE_DISABLE_MODELS_FETCH': '1', 'OPENCODE_DISABLE_CLAUDE_CODE': '1', 'OPENCODE_FILEWATCHER_DISABLE': '1',
                }
                process = subprocess.Popen([os.environ.get('OPENCODE_BINARY', '/usr/bin/opencode'), 'serve', '--stdio', '--port', '0'],
                                           cwd=root / 'project', env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
                deadline = time.monotonic() + OPERATION_SECONDS_MAX
                for _ in range(64):
                    ready, _, _ = select.select([process.stdout], [], [], max(0, deadline - time.monotonic()))
                    if not ready:
                        break
                    line = process.stdout.readline(BODY_BYTES_MAX)
                    if not line:
                        break
                    try:
                        message = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(message, dict) and 'url' in message:
                        server_url = message['url']
                        case.assertTrue(server_url.startswith('http://127.0.0.1:'))
                        wait_plugin()
                        return
                case.fail('Isolated OpenCode did not start')

            def prompt(session_id, phase):
                request('POST', f'/api/session/{session_id}/prompt', {'text': phase})
                request('POST', f'/api/experimental/session/{session_id}/wait', {})
                case.assertEqual(errors, [])
                info = request('GET', f'/api/session/{session_id}')['data']
                case.assertEqual(info.get('outcome'), 'succeeded', info.get('outcome'))
                case.assertGreater(cursors.get(phase, 0), 0, 'Provider must observe this prompt')

            try:
                start()
                session = request('POST', '/api/session', {'title': 'Isolated rule lifecycle'})['data']
                session_id = session['id']
                prompt(session_id, 'ADD')
                case.assertIsNotNone(rule_id)
                prompt(session_id, 'DUPLICATE')
                prompt(session_id, 'INVALID')
                request('POST', '/api/location/reload', {})
                wait_plugin()
                prompt(session_id, 'RELOAD')
                request('POST', f'/api/session/{session_id}/compact', {})
                request('POST', f'/api/experimental/session/{session_id}/wait', {})
                case.assertEqual(errors, [])
                history = request('GET', f'/api/session/{session_id}/message')
                case.assertIn('SCRIPTED_OPENCODE_COMPACTION_SUMMARY', json.dumps(history), 'Native compaction must persist the summary')
                prompt(session_id, 'COMPACTED')
                stop()
                start()
                prompt(session_id, 'RESUMED')
                fork = request('POST', f'/api/session/{session_id}/fork', {})['data']
                case.assertNotEqual(fork['id'], session_id)
                prompt(fork['id'], 'FORK')
                fresh = request('POST', '/api/session', {'title': 'Fresh isolated session'})['data']
                prompt(fresh['id'], 'FRESH')
                prompt(session_id, 'REMOVE')
                request('POST', '/api/location/reload', {})
                wait_plugin()
                prompt(session_id, 'REMOVED_RELOAD')
                stop()
                start()
                prompt(session_id, 'REMOVED_RESUME')
                cursors.pop('ADD')
                prompt(session_id, 'ADD')
                request('DELETE', f'/api/session/{session_id}')
                recreated = request('POST', '/api/session', {'id': session_id, 'title': 'Recreated isolated session'})['data']
                case.assertEqual(recreated['id'], session_id)
                prompt(session_id, 'REUSED_ID')
                case.assertEqual(instructions.read_bytes(), original_instructions)
                case.assertTrue(any('Return only the structured summary in the requested format.' in json.dumps(body['messages']) for body in captured), 'Native compactor must request a summary')
                case.assertEqual(errors, [])
                print(f'PASS OpenCode isolated lifecycle: {len(captured)} scripted loopback requests; no personal state or real model service.')
            finally:
                try:
                    stop()
                finally:
                    provider.shutdown()
                    provider.server_close()
                    provider_thread.join(timeout=5)
                    case.assertFalse(provider_thread.is_alive())
        self.assertFalse(root.exists(), 'Task profile must be removed')


if __name__ == '__main__':
    unittest.main()
