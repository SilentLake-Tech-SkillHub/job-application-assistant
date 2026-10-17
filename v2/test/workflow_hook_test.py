import hashlib,json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class WorkflowHookTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.policy=self.root/'policy.md';self.policy.write_text('Detailed policy is a reference, not per-turn context.',encoding='utf-8');self.scope=self.root/'scope.json';self.scope.write_text(json.dumps({'session_ids':['enabled']}));self.lock=self.root/'lock.json';self.lock.write_text(json.dumps({'version':'synthetic','sha256':hashlib.sha256(self.policy.read_bytes()).hexdigest(),'route_sha256':hashlib.sha256((ROOT/'hooks/route.md').read_bytes()).hexdigest()}));self.env={**os.environ,'RECRUITING_WORKSPACE_ROOT':str(self.root),'RECRUITING_WORKFLOW_POLICY':str(self.policy),'RECRUITING_WORKFLOW_SCOPE':str(self.scope),'RECRUITING_WORKFLOW_LOCK':str(self.lock),'RECRUITING_WORKFLOW_STATE':str(self.root/'state')}
 def tearDown(self):self.tmp.cleanup()
 def invoke(self,**args):
  event={'session_id':'enabled','turn_id':'turn','cwd':str(self.root),'hook_event_name':'PreToolUse','tool_name':'mcp__recruiting_application_v2__batch_prepare',**args}
  return subprocess.run([sys.executable,str(ROOT/'hooks/workflow_hook.py')],input=json.dumps(event),text=True,encoding="utf-8",capture_output=True,env=self.env)
 def test_short_route_injection_and_same_turn_mutation_receipt(self):
  r=self.invoke(hook_event_name='UserPromptSubmit');self.assertEqual(r.returncode,0,r.stderr);ctx=json.loads(r.stdout)['hookSpecificOutput']['additionalContext'];self.assertIn('company_batch_create',ctx);self.assertNotIn(self.policy.read_text(),ctx);self.assertLess(len(ctx.encode('utf-8')),1800);self.assertEqual(self.invoke().returncode,0)
 def test_unloaded_mutation_denied_but_maintenance_and_reads_work(self):
  self.assertEqual(self.invoke().returncode,2)
  for tool in ['Bash','apply_patch','mcp__recruiting_form__profile_status','mcp__recruiting_form__workflow_next']:self.assertEqual(self.invoke(tool_name=tool).returncode,0)
 def test_other_conversation_unaffected_by_missing_policy(self):
  self.policy.unlink();self.assertEqual(json.loads(self.invoke(session_id='other').stdout),{})
 def test_receipt_from_another_turn_never_releases_mutation(self):
  self.invoke(hook_event_name='UserPromptSubmit');self.assertEqual(self.invoke(turn_id='other').returncode,2)

 def test_legacy_application_mutation_is_rejected_only_in_enabled_conversation(self):
  self.invoke(hook_event_name='UserPromptSubmit')
  r=self.invoke(tool_name='mcp__recruiting_form__batch_prepare');self.assertEqual(r.returncode,2);self.assertIn('V2_RUNTIME_REQUIRED',r.stderr)
  self.assertEqual(self.invoke(tool_name='mcp__recruiting_form__batch_prepare',session_id='other').returncode,0)
