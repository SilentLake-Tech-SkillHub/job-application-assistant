import hashlib,json,os,shlex,subprocess,sys,tempfile,unittest,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def scope_state(ids):
 now=time.time()
 return {'session_ids':ids,'sessions':{sid:{'registeredAt':now,'expiresAt':now+12*3600} for sid in ids}}
class WorkflowHookTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.policy=self.root/'policy.md';self.policy.write_text('Detailed policy is a reference, not per-turn context.',encoding='utf-8');self.scope=self.root/'scope.json';self.scope.write_text(json.dumps(scope_state(['enabled'])));self.lock=self.root/'lock.json';self.lock.write_text(json.dumps({'version':'synthetic','sha256':hashlib.sha256(self.policy.read_bytes()).hexdigest(),'route_sha256':hashlib.sha256((ROOT/'hooks/route.md').read_bytes()).hexdigest()}));self.env={**os.environ,'RECRUITING_HOST_ROLE':'executor','RECRUITING_WORKSPACE_ROOT':str(self.root),'RECRUITING_WORKFLOW_POLICY':str(self.policy),'RECRUITING_WORKFLOW_SCOPE':str(self.scope),'RECRUITING_WORKFLOW_LOCK':str(self.lock),'RECRUITING_WORKFLOW_STATE':str(self.root/'state')}
 def tearDown(self):self.tmp.cleanup()
 def invoke(self,**args):
  event={'session_id':'enabled','turn_id':'turn','cwd':str(self.root),'hook_event_name':'PreToolUse','tool_name':'mcp__recruiting_application_v2__batch_prepare',**args}
  return subprocess.run([sys.executable,str(ROOT/'hooks/workflow_hook.py')],input=json.dumps(event),text=True,encoding="utf-8",capture_output=True,env=self.env)
 def test_short_route_injection_and_same_turn_mutation_receipt(self):
  r=self.invoke(hook_event_name='UserPromptSubmit');self.assertEqual(r.returncode,0,r.stderr);ctx=json.loads(r.stdout)['hookSpecificOutput']['additionalContext'];self.assertIn('company_batch_create',ctx);self.assertNotIn(self.policy.read_text(),ctx);self.assertLess(len(ctx.encode('utf-8')),1800);self.assertEqual(self.invoke().returncode,0)
 def test_unloaded_mutation_denied_but_maintenance_and_reads_work(self):
  self.assertEqual(self.invoke().returncode,2)
  self.assertEqual(self.invoke(tool_name='mcp__recruiting_application_v2__role_prepare_materials').returncode,2)
  for tool in ['Bash','apply_patch','mcp__recruiting_form__profile_status','mcp__recruiting_form__workflow_next']:
   self.assertEqual(self.invoke(tool_name=tool).returncode,2)
   self.assertEqual(self.invoke(session_id='maintenance',tool_name=tool).returncode,0)
  self.assertEqual(self.invoke(tool_name='read_file',tool_input={'path':str(ROOT/'SKILL.md')}).returncode,0)
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
  self.scope.write_text(json.dumps(scope_state(['session-executor'])))
  self.invoke(session_id='session-executor',hook_event_name='UserPromptSubmit')
  for tool,args in [('Bash',{'command':'node /tmp/fill.mjs'}),('mcp__playwright__browser_evaluate',{'function':'() => 1'}),('apply_patch',{'patch':'x'}),('read_file',{'path':str(self.root/'private.json')})]:
   result=self.invoke(session_id='session-executor',tool_name=tool,tool_input=args)
   self.assertEqual(result.returncode,2,result.stdout);self.assertIn('EXECUTOR_MCP_ONLY',result.stderr)
  self.assertEqual(self.invoke(session_id='session-executor',tool_name='read_file',tool_input={'path':str(ROOT/'SKILL.md')}).returncode,0)
  self.assertEqual(self.invoke(session_id='session-executor',tool_name='mcp__recruiting-application-v2__role_prepare').returncode,0)
  self.assertEqual(self.invoke(session_id='maintainer',tool_name='apply_patch').returncode,0)

 def test_dsh_text_planning_is_allowed_but_file_operations_remain_scoped(self):
  self.scope.write_text(json.dumps(scope_state(['session-executor'])))
  for tool,args in [('todo_write',{'todos':[{'content':'Read the component Skill','status':'pending'}]}),('AskUserQuestion',{'questions':[{'question':'Complete the captcha in the clone'}]})]:
   r=self.invoke(session_id='session-executor',tool_name=tool,tool_input=args)
   self.assertEqual(r.returncode,0,r.stderr)
  r=self.invoke(session_id='session-executor',tool_name='read',tool_input={'file_path':str(ROOT/'SKILL.md'),'command':''})
  self.assertEqual(r.returncode,0,r.stderr)
  for path in [self.root/'workbook.xlsx',self.root/'runtime.json']:
   r=self.invoke(session_id='session-executor',tool_name='read',tool_input={'file_path':str(path),'command':''})
   self.assertEqual(r.returncode,2);self.assertIn('EXECUTOR_MCP_ONLY',r.stderr)

 def test_executor_boundary_uses_registered_scope_not_host_name_or_session_prefix(self):
  for host,session in [('codex','01abc-uuid'),('dsh','arbitrary-id'),('claude-code','claude-uuid')]:
   with self.subTest(host=host):
    self.env.update(RECRUITING_HOST_ID=host,RECRUITING_HOST_ROLE='executor')
    self.scope.write_text(json.dumps(scope_state([session])))
    self.invoke(session_id=session,hook_event_name='UserPromptSubmit')
    r=self.invoke(session_id=session,tool_name='Bash',tool_input={'command':'node /tmp/fill.mjs'})
    self.assertEqual(r.returncode,2,r.stdout);self.assertIn('EXECUTOR_MCP_ONLY',r.stderr)
    self.assertEqual(self.invoke(session_id=session,tool_name='mcp__recruiting-application-v2__role_prepare').returncode,0)
    command=shlex.join(['cat',str(ROOT/'SKILL.md')])
    self.assertEqual(self.invoke(session_id=session,tool_name='exec_command',tool_input={'cmd':command}).returncode,0)
    for forbidden in [command+'; node /tmp/fill.mjs',shlex.join(['cat',str(self.root/'private.json')]),command+' > /tmp/overwrite']:
     self.assertEqual(self.invoke(session_id=session,tool_name='exec_command',tool_input={'cmd':forbidden}).returncode,2)
    self.assertEqual(self.invoke(session_id='unregistered',tool_name='apply_patch').returncode,0)

 def test_maintainer_role_does_not_enter_stale_execution_scope(self):
  self.env['RECRUITING_HOST_ROLE']='maintainer'
  self.scope.write_text(json.dumps(scope_state(['session-old'])))
  r=self.invoke(session_id='session-old',tool_name='apply_patch',tool_input={'patch':'source fix'})
  self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual(json.loads(self.invoke(session_id='session-old',hook_event_name='UserPromptSubmit').stdout),{})

 def test_single_host_can_leave_execution_scope_through_current_session_command(self):
  self.env['RECRUITING_HOST_ROLE']='executor'
  self.scope.write_text(json.dumps(scope_state(['session-single'])))
  command=shlex.join([sys.executable,str(ROOT / 'hooks/conversation_scope.py'),'disable','--scope-file',str(self.scope)])
  r=self.invoke(session_id='session-single',tool_name='exec_command',tool_input={'cmd':command})
  self.assertEqual(r.returncode,0,r.stderr)

 def test_hook_also_loads_through_host_runpy_wrapper(self):
  code="import runpy; runpy.run_path("+repr(str(ROOT/'hooks/workflow_hook.py'))+", run_name='__main__')"
  event={'session_id':'enabled','turn_id':'wrapper','cwd':str(self.root),'hook_event_name':'UserPromptSubmit'}
  r=subprocess.run([sys.executable,'-c',code],input=json.dumps(event),text=True,capture_output=True,env=self.env,cwd=self.root)
  self.assertEqual(r.returncode,0,r.stderr);self.assertIn('hookSpecificOutput',json.loads(r.stdout))
 def test_text_tool_definition_is_the_shared_file_and_file_arguments_anywhere_are_checked(self):
  spec=json.loads((ROOT/'hooks/tool-arguments.json').read_text(encoding='utf-8'))
  self.assertIn('todo_write',spec['textTools']);self.assertIn('TargetFile',spec['fileArgumentKeys'])
  self.scope.write_text(json.dumps(scope_state(['session-executor'])))
  workbook=str(self.root/'workbook.xlsx')
  for tool,args in [('send_message',{'message':'started Keep'}),('notify',{'text':'done'})]:
   r=self.invoke(session_id='session-executor',tool_name=tool,tool_input=args);self.assertEqual(r.returncode,0,r.stderr)
  # A text tool carrying a file argument, at any depth or under any listed name, is not text-only.
  for tool,args in [('todo_write',{'todos':[],'TargetFile':workbook}),('send_message',{'message':{'body':'x','attachments':[workbook]}}),('AskUserQuestion',{'questions':[{'question':'q','notebook_path':workbook}]})]:
   r=self.invoke(session_id='session-executor',tool_name=tool,tool_input=args);self.assertEqual(r.returncode,2,(tool,r.stderr));self.assertIn('EXECUTOR_MCP_ONLY',r.stderr)
  # Arguments that are not an object never crash the hook.
  r=self.invoke(session_id='session-executor',tool_name='read',tool_input=[workbook]);self.assertIn(r.returncode,(0,2));self.assertNotIn('Traceback',r.stderr)
