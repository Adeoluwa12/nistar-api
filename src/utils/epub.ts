import AdmZip from 'adm-zip';

export interface WatermarkInfo {
  readerName: string;
  email?: string;
  date?: Date;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const shown = local.slice(0, 2);
  return `${shown}${'*'.repeat(Math.max(1, local.length - shown.length))}@${domain}`;
}

/**
 * Injects a personalised watermark page into an EPUB (which is a ZIP archive)
 * as the first item in the reading order. Best-effort: if the package (.opf)
 * cannot be located/parsed the original buffer is returned unchanged so a
 * download never fails.
 */
export function watermarkEpub(input: Buffer, info: WatermarkInfo): Buffer {
  try {
    const zip = new AdmZip(input);
    const entries = zip.getEntries();

    const opfEntry = entries.find((e) => e.entryName.toLowerCase().endsWith('.opf'));
    if (!opfEntry) return input;

    const opfPath = opfEntry.entryName;
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    let opf = zip.readAsText(opfEntry);

    const wmFileName = 'nistar-watermark.xhtml';
    const wmId = 'nistar-watermark';
    const dateStr = (info.date || new Date()).toLocaleDateString();
    const maskedEmail = info.email ? maskEmail(info.email) : '';

    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="utf-8"/><title>Nistar</title></head>
<body>
  <div style="text-align:center;padding:3em 1em;font-family:serif;">
    <h1 style="color:#6B8E5A;margin-bottom:0.2em;">Nistar</h1>
    <p style="color:#666;">A safe space for mental health</p>
    <hr style="width:40%;margin:2em auto;"/>
    <p>This copy was prepared for</p>
    <p style="font-size:1.3em;font-weight:bold;">${escapeXml(info.readerName)}</p>
    ${maskedEmail ? `<p style="color:#888;">${escapeXml(maskedEmail)}</p>` : ''}
    <p style="color:#888;">Downloaded ${escapeXml(dateStr)}</p>
    <p style="font-size:0.8em;color:#aaa;margin-top:3em;">Shared through the Nistar community. Please do not redistribute.</p>
  </div>
</body>
</html>`;

    zip.addFile(opfDir + wmFileName, Buffer.from(xhtml, 'utf8'));

    if (/<manifest[^>]*>/i.test(opf) && !opf.includes(`id="${wmId}"`)) {
      opf = opf.replace(
        /<manifest[^>]*>/i,
        (m) => `${m}\n    <item id="${wmId}" href="${wmFileName}" media-type="application/xhtml+xml"/>`
      );
    }
    if (/<spine[^>]*>/i.test(opf) && !opf.includes(`idref="${wmId}"`)) {
      opf = opf.replace(
        /<spine[^>]*>/i,
        (m) => `${m}\n    <itemref idref="${wmId}"/>`
      );
    }

    zip.updateFile(opfPath, Buffer.from(opf, 'utf8'));
    return zip.toBuffer();
  } catch {
    return input;
  }
}
