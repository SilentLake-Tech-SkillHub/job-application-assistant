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
  self.assertEqual(self.invoke(tool_name='mcp__recruiting_application_v2__role_prepare_materials').returncode,2)
  for tool in ['Bash','apply_patch','mcp__recruiting_form__profile_status','mcp__recruiting_form__workflow_next']:self.assertEqual(self.invoke(tool_name=tool).returncode,0)
 def test_other_conversation_unaffected_by_missing_policy(self):
  self.policy.unlink();self.assertEqual(json.loads(self.invoke(session_id='other').stdout),{})
 def test_receipt_from_another_turn_never_releases_mutation(self):
  self.invoke(hook_event_name='UserPromptSubmit');self.assertEqual(self.invoke(turn_id='other').returncode,2)

 def test_repeated_stops_without_new_tools_escalate_to_supervisor(self):
  response={'continuation':{'state':'map','owner':'agent','requiresUser':False,'shouldContinue':True}}
  self.invoke(hook_event_name='PostToolUse',tool_name='mcp__recruiting_application_v2__workflow_next',tool_response=response)
  self.assertEqual(json.loads(self.invoke(hook_event_name='Stop',session_id='other').stdout),{})
  self.assertEqual(json.loads(self.invoke(hook_event_name='Stop',turn_id='other').stdout),{})
  self.assertEqual(json.loads(self.invoke(hook_event_name='Stop').stdout)['decision'],'block')
  self.assertIn('AGENT_NO_PROGRESS_LOOP',json.loads(self.invoke(hook_event_name='Stop').stdout)['systemMessage'])
  state=json.loads(next((self.root/'state').glob('continuation-*.json')).read_text())
  self.assertEqual(state['owner'],'supervisor');self.assertFalse(state['requiresUser']);self.assertFalse(state['complete'])
  self.assertEqual(json.loads(self.invoke(hook_event_name='Stop').stdout),{})
  self.invoke(hook_event_name='PostToolUse',tool_name='mcp__recruiting_application_v2__workflow_next',tool_response=response)
  self.assertEqual(json.loads(self.invoke(hook_event_name='Stop').stdout)['decision'],'block')
  self.invoke(hook_event_name='PostToolUse',tool_name='mcp__recruiting_application_v2__workflow_handoff',tool_response={'continuation':{'state':'technical_block','owner':'supervisor','requiresUser':False,'shouldContinue':False,'handoffVerified':True}})
  self.assertEqual(json.loads(self.invoke(hook_event_name='Stop').stdout),{})

 def test_declared_new_stage_is_tracked_with_dsh_hyphenated_namespace(self):
  response={'workflowContract':{'revision':1,'tracked':True},'continuation':{'state':'construct','owner':'agent','shouldContinue':True}}
  self.invoke(hook_event_name='PostToolUse',tool_name='mcp__recruiting-application-v2__future_stage',tool_response={'content':[{'type':'text','text':json.dumps(response)}]})
  self.assertEqual(json.loads(self.invoke(hook_event_name='Stop').stdout)['decision'],'block')

 def test_sdk_argument_failure_cannot_leave_enabled_workflow_without_pending_state(self):
  self.invoke(hook_event_name='UserPromptSubmit')
  self.invoke(tool_name='mcp__recruiting-application-v2__form_build_template')
  self.invoke(hook_event_name='PostToolUse',tool_name='mcp__recruiting-application-v2__form_build_template',tool_response={'isError':True,'content':[{'type':'text','text':'Invalid arguments'}]})
  self.assertEqual(json.loads(self.invoke(hook_event_name='Stop').stdout)['decision'],'block')

 def test_actual_dsh_error_text_prefix_preserves_technical_continuation(self):
  response={'workflowContract':{'revision':1,'tracked':True},'continuation':{'state':'technical_block','owner':'agent','shouldContinue':True}}
  self.invoke(hook_event_name='PostToolUse',tool_name='mcp__recruiting-application-v2__capture_choice_options',tool_response='Error: '+json.dumps(response))
  self.assertEqual(json.loads(self.invoke(hook_event_name='Stop').stdout)['decision'],'block')

 def test_real_user_wait_and_review_allow_stop(self):
  for state in ['user_input','review']:
   self.invoke(hook_event_name='PostToolUse',tool_name='mcp__recruiting_application_v2__role_prepare',tool_response={'content':[{'type':'text','text':json.dumps({'continuation':{'state':state,'owner':'user','requiresUser':True}})}]})
   self.assertEqual(json.loads(self.invoke(hook_event_name='Stop').stdout),{})

 def test_legacy_application_mutation_is_rejected_only_in_enabled_conversation(self):
  self.invoke(hook_event_name='UserPromptSubmit')
  r=self.invoke(tool_name='mcp__recruiting_form__batch_prepare');self.assertEqual(r.returncode,2);self.assertIn('V2_RUNTIME_REQUIRED',r.stderr)
  self.assertEqual(self.invoke(tool_name='mcp__recruiting_form__batch_prepare',session_id='other').returncode,0)

 def test_dsh_executor_cannot_use_external_browser_shell_or_runtime_file_edits(self):
  self.scope.write_text(json.dumps({'session_ids':['session-executor']}))
  self.invoke(session_id='session-executor',hook_event_name='UserPromptSubmit')
  for tool,args in [('Bash',{'command':'node /tmp/fill.mjs'}),('mcp__playwright__browser_evaluate',{'function':'() => 1'}),('apply_patch',{'patch':'x'}),('read_file',{'path':str(self.root/'private.json')})]:
   result=self.invoke(session_id='session-executor',tool_name=tool,tool_input=args)
   self.assertEqual(result.returncode,2,result.stdout);self.assertIn('EXECUTOR_MCP_ONLY',result.stderr)
  self.assertEqual(self.invoke(session_id='session-executor',tool_name='read_file',tool_input={'path':str(ROOT/'SKILL.md')}).returncode,0)
  self.assertEqual(self.invoke(session_id='session-executor',tool_name='mcp__recruiting-application-v2__role_prepare').returncode,0)
  self.assertEqual(self.invoke(session_id='maintainer',tool_name='apply_patch').returncode,0)
