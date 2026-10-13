#!/usr/bin/env python3
"""个人信息档案: résumé → plain-text base profile, staleness, never-store guard, answer write-back,
and the 需用户 → 待填 handshake with the fill cache. Synthetic résumé only."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import profile_vault as pv  # noqa: E402
import fill_plan as fp  # noqa: E402

ENV = dict(os.environ, PYTHONIOENCODING='utf-8')
RESUME = '合成候选人\n手机：138-0000-0000  邮箱：candidate@example.test\n合成大学 硕士 人工智能 2025.07–2026.06\n'


def run(*args):
    r = subprocess.run([sys.executable, str(HERE / 'profile_vault.py'), *args], capture_output=True, text=True, encoding='utf-8', env=ENV)
    return r.returncode, json.loads(r.stdout)


def make_pdf(path, text):
    """A minimal one-page PDF with ASCII text (enough for pypdf / pdftotext)."""
    stream = 'BT /F1 12 Tf 50 750 Td (%s) Tj ET' % text
    objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
            '<< /Length %d >>\nstream\n%s\nendstream' % (len(stream), stream), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    out, offsets = b'%PDF-1.4\n', []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += ('%d 0 obj\n%s\nendobj\n' % (i, body)).encode('latin-1')
    xref = len(out)
    out += ('xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)).encode() + ''.join('%010d 00000 n \n' % o for o in offsets).encode()
    out += ('trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, xref)).encode()
    Path(path).write_bytes(out)


class VaultTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.vault = self.root / '私有' / '个人信息档案.md'
        self.resume = self.root / '简历.txt'
        self.resume.write_text(RESUME, encoding='utf-8')

    def tearDown(self):
        self.tmp.cleanup()

    def test_init_builds_text_base_and_fills_contacts(self):
        out = pv.init(self.resume, self.vault)
        text = self.root / '私有' / '简历文本.md'
        self.assertTrue(text.is_file())
        self.assertIn('合成大学', text.read_text(encoding='utf-8'))
        values = fp.vault_values(self.vault)
        self.assertEqual(values['手机号'], '13800000000')
        self.assertEqual(values['邮箱'], 'candidate@example.test')
        self.assertEqual(values['简历哈希'], pv.sha256(self.resume))
        self.assertIn('学校', out['待从简历文本补齐'])
        self.assertTrue(pv.check(self.vault, self.resume)['通过'])

    def test_user_values_survive_reinit_and_resume_change_is_detected(self):
        pv.init(self.resume, self.vault)
        pv.add(self.vault, '学校', '合成大学')
        pv.add(self.vault, '手机号', '13900000000', source='用户更正')
        self.resume.write_text(RESUME + '新增项目\n', encoding='utf-8')
        self.assertTrue(any('简历已更换' in e for e in pv.check(self.vault, self.resume)['错误']))
        pv.init(self.resume, self.vault)
        values = fp.vault_values(self.vault)
        self.assertEqual(values['学校'], '合成大学')
        self.assertEqual(values['手机号'], '13900000000')  # the user's correction is not overwritten
        self.assertTrue(pv.check(self.vault, self.resume)['通过'])
        self.assertIn('已更新', self.vault.read_text(encoding='utf-8').split('## 变更记录')[1])

    def test_add_new_answer_and_refuse_never_store(self):
        pv.init(self.resume, self.vault)
        self.assertEqual(pv.add(self.vault, '紧急联系人电话', '13700000000', source='用户 10-14 答复')['写入'], 'new')
        self.assertEqual(fp.vault_values(self.vault)['紧急联系人电话'], '13700000000')
        for field, value in (('身份证号', '11010519491231002X'), ('短信验证码', '123456'), ('备注', '6222020200112233445')):
            with self.assertRaises(ValueError):
                pv.add(self.vault, field, value)
        self.vault.write_text(self.vault.read_text(encoding='utf-8') + '| 护照号 | E12345678 | | |\n', encoding='utf-8')
        self.assertTrue(any('永不记录' in e for e in pv.check(self.vault)['错误']))

    def test_pdf_and_docx_extraction(self):
        pdf = self.root / 'resume.pdf'
        make_pdf(pdf, 'Synthetic Candidate  candidate@example.test  +65 8123 4567')
        pv.init(pdf, self.vault)
        values = fp.vault_values(self.vault)
        self.assertEqual(values['邮箱'], 'candidate@example.test')
        self.assertEqual(values['手机号'], '+6581234567')
        docx = self.root / 'resume.docx'
        with zipfile.ZipFile(docx, 'w') as z:
            z.writestr('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>合成候选人 doc@example.test</w:t></w:r></w:p></w:body></w:document>')
        self.assertIn('doc@example.test', pv.extract_text(docx))
        with self.assertRaises(ValueError):
            pv.extract_text(self.root / 'x.png')

    def test_fill_plan_handshake_via_cli(self):
        code, out = run('init', '--resume', str(self.resume), '--vault', str(self.vault))
        self.assertEqual(code, 0, out)
        plan = self.root / '填写方案.json'
        fp.save(plan, {'方案版本': 1, '批次': 'b1', '公司': 'A', '岗位链接': 'https://e.test/1', '通道': '内置浏览器', '字段': [
            {'序号': 1, '标签': '紧急联系人电话', '定位': {'label': '紧急联系人电话'}, '控件': '文本', '填法': '批量',
             '值来源': '档案:紧急联系人电话', '状态': '需用户'}]})
        r = subprocess.run([sys.executable, str(HERE / 'fill_plan.py'), 'vault-sync', str(plan), '--vault', str(self.vault)],
                           capture_output=True, text=True, encoding='utf-8', env=ENV)
        self.assertEqual(r.returncode, 1)
        self.assertIn('紧急联系人电话', r.stdout)
        code, out = run('has', '--vault', str(self.vault), '--field', '紧急联系人电话')
        self.assertEqual((code, out['缺少']), (1, ['紧急联系人电话']))
        code, out = run('add', '--vault', str(self.vault), '--field', '紧急联系人电话', '--value', '13700000000', '--source', '用户答复')
        self.assertEqual(code, 0, out)
        self.assertNotIn('13700000000', json.dumps(out, ensure_ascii=False))  # values are never echoed
        r = subprocess.run([sys.executable, str(HERE / 'fill_plan.py'), 'vault-sync', str(plan), '--vault', str(self.vault)],
                           capture_output=True, text=True, encoding='utf-8', env=ENV)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertEqual(fp.load(plan)['字段'][0]['状态'], '待填')
        self.assertNotIn('13700000000', plan.read_text(encoding='utf-8'))
        code, out = run('add', '--vault', str(self.vault), '--field', '身份证号', '--value', '11010519491231002X')
        self.assertEqual(code, 1)


if __name__ == '__main__':
    unittest.main()
