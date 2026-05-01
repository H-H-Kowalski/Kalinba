const fs = require('fs');
const path = require('path');

const docsDir = __dirname;

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function markdownToHtml(md, opts = {}) {
    const lines = md.split(/\r?\n/);
    const out = [];
    let i = 0;
    let inCodeBlock = false;
    let codeLang = '';
    let codeLines = [];
    let inTable = false;
    let tableRows = [];

    function flushTable() {
        if (!inTable) return;
        inTable = false;
        out.push('<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; border:1px solid #999; width:100%; margin:8px 0;">');
        for (let ri = 0; ri < tableRows.length; ri++) {
            const row = tableRows[ri];
            if (ri === 1 && row.every(c => /^[-:]+$/.test(c.trim()))) continue;
            const tag = ri === 0 ? 'th' : 'td';
            const bgStyle = ri === 0 ? ' style="background:#f0f0f0; font-weight:bold;"' : '';
            out.push('<tr>');
            for (const cell of row) {
                out.push(`<${tag}${bgStyle}>${inlineFormat(cell.trim())}</${tag}>`);
            }
            out.push('</tr>');
        }
        out.push('</table>');
        tableRows = [];
    }

    function inlineFormat(text) {
        text = escapeHtml(text);
        text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        text = text.replace(/`([^`]+)`/g, '<code style="background:#f5f5f5; padding:1px 4px; font-family:Consolas,monospace; font-size:10pt;">$1</code>');
        text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
        return text;
    }

    while (i < lines.length) {
        const line = lines[i];

        if (inCodeBlock) {
            if (/^```/.test(line)) {
                inCodeBlock = false;
                const codeText = codeLines.map(l => escapeHtml(l)).join('\n');
                if (opts.isSourceDoc) {
                    out.push(`<pre style="font-family:Consolas,'Courier New',monospace; font-size:9pt; line-height:1.3; background:#fafafa; border:1px solid #ddd; padding:6px 10px; page-break-inside:auto; white-space:pre-wrap; word-wrap:break-word;">${codeText}</pre>`);
                } else {
                    out.push(`<pre style="font-family:Consolas,'Courier New',monospace; font-size:9pt; background:#f8f8f8; border:1px solid #ddd; padding:8px 12px; white-space:pre-wrap; word-wrap:break-word;">${codeText}</pre>`);
                }
                codeLines = [];
                i++;
                continue;
            }
            codeLines.push(line);
            i++;
            continue;
        }

        if (/^```/.test(line)) {
            flushTable();
            inCodeBlock = true;
            codeLang = line.replace(/^```/, '').trim();
            codeLines = [];
            i++;
            continue;
        }

        if (/^\|/.test(line) && line.includes('|')) {
            const cells = line.split('|').slice(1);
            if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
            if (!inTable) inTable = true;
            tableRows.push(cells);
            i++;
            continue;
        } else {
            flushTable();
        }

        if (/^---\s*$/.test(line)) {
            out.push('<hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">');
            i++;
            continue;
        }

        if (/^#{1,6}\s/.test(line)) {
            const match = line.match(/^(#{1,6})\s+(.*)/);
            const level = match[1].length;
            const text = inlineFormat(match[2]);
            const sizes = { 1: '18pt', 2: '15pt', 3: '13pt', 4: '12pt', 5: '11pt', 6: '10.5pt' };
            const topMargin = level <= 2 ? '24px' : '16px';
            if (level <= 2) {
                out.push(`<h${level} style="font-size:${sizes[level]}; margin-top:${topMargin}; margin-bottom:8px; page-break-after:avoid;">${text}</h${level}>`);
            } else {
                out.push(`<h${level} style="font-size:${sizes[level]}; margin-top:${topMargin}; margin-bottom:6px;">${text}</h${level}>`);
            }
            i++;
            continue;
        }

        if (/^>\s/.test(line)) {
            let blockLines = [];
            while (i < lines.length && (/^>\s?/.test(lines[i]) || (lines[i].trim() === '' && i + 1 < lines.length && /^>\s?/.test(lines[i + 1])))) {
                blockLines.push(lines[i].replace(/^>\s?/, ''));
                i++;
            }
            const content = blockLines.map(l => inlineFormat(l)).join('<br>');

            if (content.includes('截图')) {
                out.push(`<div style="border:2px dashed #4a90d9; background:#eef4fb; padding:20px; margin:16px 0; text-align:center; min-height:200px;">
                    <p style="color:#2c5aa0; font-size:14pt; font-weight:bold; margin:0 0 10px 0;">${content.replace(/<br>/g, ' ')}</p>
                    <p style="color:#888; font-size:10pt; margin:0;">[ 请在此处粘贴截图，选中此文字后直接 Ctrl+V 粘贴即可 ]</p>
                </div>`);
            } else {
                out.push(`<blockquote style="border-left:3px solid #ccc; padding-left:12px; margin:10px 0; color:#555;">${content}</blockquote>`);
            }
            continue;
        }

        if (/^\d+\.\s/.test(line)) {
            let listItems = [];
            while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
                listItems.push(lines[i].replace(/^\d+\.\s+/, ''));
                i++;
            }
            out.push('<ol style="margin:6px 0; padding-left:28px;">');
            for (const item of listItems) {
                out.push(`<li style="margin:3px 0;">${inlineFormat(item)}</li>`);
            }
            out.push('</ol>');
            continue;
        }

        if (/^[-*]\s/.test(line)) {
            let listItems = [];
            while (i < lines.length && /^[-*]\s/.test(lines[i])) {
                listItems.push(lines[i].replace(/^[-*]\s+/, ''));
                i++;
            }
            out.push('<ul style="margin:6px 0; padding-left:28px;">');
            for (const item of listItems) {
                out.push(`<li style="margin:3px 0;">${inlineFormat(item)}</li>`);
            }
            out.push('</ul>');
            continue;
        }

        if (opts.isSourceDoc && /^\*\*拇指琴演奏家/.test(line)) {
            out.push(`<p style="font-size:11pt; font-weight:bold; margin:20px 0 6px 0; page-break-before:auto;">${inlineFormat(line)}</p>`);
            i++;
            continue;
        }

        if (line.trim() === '') {
            i++;
            continue;
        }

        out.push(`<p style="font-size:10.5pt; line-height:1.6; margin:4px 0; text-indent:0;">${inlineFormat(line)}</p>`);
        i++;
    }

    flushTable();
    return out.join('\n');
}

function wrapWordHtml(title, bodyHtml) {
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
  @page {
    size: A4;
    margin: 2.54cm 3.17cm 2.54cm 3.17cm;
  }
  body {
    font-family: '宋体', SimSun, 'Microsoft YaHei', serif;
    font-size: 10.5pt;
    line-height: 1.6;
    color: #000;
  }
  h1 { font-family: '黑体', SimHei, sans-serif; }
  h2 { font-family: '黑体', SimHei, sans-serif; }
  h3 { font-family: '黑体', SimHei, sans-serif; }
  table { font-size: 10pt; }
  pre { page-break-inside: auto; }
  code { font-family: Consolas, 'Courier New', monospace; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// --- Convert manual ---
const manualMd = fs.readFileSync(path.join(docsDir, '软件说明书-拇指琴演奏家软件V1.0.md'), 'utf-8');
const manualHtml = markdownToHtml(manualMd);
const manualDoc = wrapWordHtml('拇指琴演奏家软件V1.0 软件说明书', manualHtml);
fs.writeFileSync(path.join(docsDir, '软件说明书-拇指琴演奏家软件V1.0.doc'), manualDoc, 'utf-8');
console.log('OK: 软件说明书.doc');

// --- Convert report ---
const reportMd = fs.readFileSync(path.join(docsDir, '计算机软件著作权登记申请报告（Kalinba）.md'), 'utf-8');
const reportHtml = markdownToHtml(reportMd);
const reportDoc = wrapWordHtml('计算机软件著作权登记申请报告', reportHtml);
fs.writeFileSync(path.join(docsDir, '计算机软件著作权登记申请报告（Kalinba）.doc'), reportDoc, 'utf-8');
console.log('OK: 申请报告.doc');

// --- Convert source code doc ---
const sourceMd = fs.readFileSync(path.join(docsDir, '源代码文档-拇指琴演奏家软件V1.0.md'), 'utf-8');
const sourceHtml = markdownToHtml(sourceMd, { isSourceDoc: true });
const sourceDoc = wrapWordHtml('拇指琴演奏家软件V1.0 源代码文档', sourceHtml);
fs.writeFileSync(path.join(docsDir, '源代码文档-拇指琴演奏家软件V1.0.doc'), sourceDoc, 'utf-8');
console.log('OK: 源代码文档.doc');

console.log('\nDone! All 3 .doc files generated.');
