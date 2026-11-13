import { useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Alert, Button, Loading } from '../common/ui.jsx';
import { downloadFile, errMsg, fetchBlob } from '../../services/api.js';
import { fmtBytes } from '../../utils/format.js';

/**
 * Shows a PDF in the page (fetched with the login cookie, shown from a local blob URL, so the
 * file URL is never public). Other formats (DOCX) can only be downloaded.
 */
export default function DocumentPreview({ url, file, downloadUrl }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isPdf = file?.extension === 'pdf';

  useEffect(() => {
    let revoked = false;
    let href = '';
    setSrc(''); setError('');
    if (!isPdf || !url) return undefined;
    setLoading(true);
    fetchBlob(url, { disposition: 'inline' })
      .then(({ blob }) => { if (!revoked) { href = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })); setSrc(href); } })
      .catch((e) => !revoked && setError(errMsg(e)))
      .finally(() => !revoked && setLoading(false));
    return () => { revoked = true; if (href) URL.revokeObjectURL(href); };
  }, [url, isPdf]);

  const download = () => downloadFile(downloadUrl || url, file?.originalName).catch((e) => setError(errMsg(e)));
  return (
    <div className="stack-sm">
      <div className="row between">
        <span className="row" style={{ gap: 8 }}><FileText size={18} /><strong>{file?.originalName}</strong><span className="muted small">{fmtBytes(file?.size)}</span></span>
        <Button variant="secondary" size="sm" icon={Download} onClick={download}>Download</Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {isPdf ? (loading ? <Loading text="Loading preview..." /> : src && <iframe className="preview-frame" src={src} title={`Preview of ${file.originalName}`} />) :
        <Alert tone="info">Preview is available for PDF files. Download this {file?.extension?.toUpperCase()} file to read it.</Alert>}
    </div>
  );
}
