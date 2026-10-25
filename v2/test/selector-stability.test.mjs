import test from 'node:test';import assert from 'node:assert/strict';
import {unstableClassTokens,unstableLocators} from '../shared/selector-stability.mjs';
import {validateTransition} from '../shared/entry-transition.mjs';
import {validateCompany} from '../login/contracts.mjs';
test('generated style class names are detected; ids, data attributes and plain classes are not',()=>{
 for(const s of ['div.style__STJobNameLeft-editor__sc-ydltt0-19 span','span.stylest__STTitleText-editor__sc-1af1sh0-4','a.userCenter___wJLJE','div.sc-fFeiMQ.ggdyxe','.css-1x2y3z'])assert.ok(unstableClassTokens(s).length,s);
 for(const s of ['.form-item--phoenix','#formily-item-name input','[data-cy="name"] input','.handle-btn button.deliver','.sc-header','.fixed-postInfo-con .tit','.ud__select'])assert.deepEqual(unstableClassTokens(s),[],s);
});
const entry=capturedAt=>({kind:'declarative_transition',target:'same',detail:{location:{pathnamePattern:'^/job$'},roleSelector:'div.sc-fFeiMQ'},entryLocator:{text:'立即投递',label:'立即投递'},form:{location:{pathnamePattern:'^/form$'},readySelector:'.ready',roleSelector:'.title'},evidence:{detailUrl:'https://example.test/job',formUrl:'https://example.test/form',capturedAt,method:'synthetic'}});
test('entries captured from the rule date on must not use generated class names; older ones load and are reported',()=>{
 assert.throws(()=>validateTransition(entry('2026-10-26')),/ENTRY_SELECTOR_UNSTABLE/);
 assert.doesNotThrow(()=>validateTransition(entry('2026-10-24')));
 assert.deepEqual(unstableLocators({entry:entry('2026-10-24')}).map(x=>x.where),['entry.detail.roleSelector']);
});
test('user-operated account locator follows the same rule',()=>{
 const c={schemaVersion:1,companyId:'x',version:1,origin:'https://example.test',loginPath:'/login',allowedPaths:['/'],loginMethod:'user_operated',account:{mask:'exact',source:'a',selector:'a.userCenter___wJLJE',pageUrl:'https://example.test/me'},success:{requiresAccountMatch:true,noApplicationSubmission:true},evidence:{sourceUrl:'https://example.test/me',capturedAt:'2026-10-27'}};
 assert.throws(()=>validateCompany(c),/ACCOUNT_SELECTOR_UNSTABLE/);
 assert.doesNotThrow(()=>validateCompany({...c,evidence:{...c.evidence,capturedAt:'2026-10-22'}}));
 assert.doesNotThrow(()=>validateCompany({...c,account:{...c.account,selector:'[data-testid="user"]'}}));
});
