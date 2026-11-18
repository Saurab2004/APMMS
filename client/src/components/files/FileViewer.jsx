import { useEffect, useState } from 'react';
import { Download, ExternalLink, Eye } from 'lucide-react';
import { Alert, Button, Loading } from '../common/ui.jsx';
import { Modal } from '../common/Modal.jsx';
import { downloadFile, errMsg, fetchBlob } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';

const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
export const extOf = (file) => String(file?.extension || (file?.originalName || '').split('.').pop() || '').toLowerCase();
export const canView = (file) => !!MIME[extOf(file)] && extOf(file) !== 'jpeg';

/** Pop-up viewer: fetches the file with the login cookie and shows it from a local blob URL (never a public link). */
export function FileViewerDialog({ url, file, onClose }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const ext = extOf(file);
  useEffect(() => {
    let dead = false;
    let href = '';
    fetchBlob(url, { disposition: 'inline' })
      .then(({ blob }) => { if (!dead) { href = URL.createObjectURL(new Blob([blob], { type: MIME[ext] || 'application/octet-stream' })); setSrc(href); } })
      .catch((e) => !dead && setError(errMsg(e)));
    return () => { dead = true; if (href) URL.revokeObjectURL(href); };
  }, [url, ext]);
  const download = () => downloadFile(url, file?.originalName).catch((e) => setError(errMsg(e)));
  return (
    <Modal wide title={file?.originalName || 'Document'} onClose={onClose}
      footer={<>
        {src && <Button variant="secondary" icon={ExternalLink} onClick={() => window.open(src, '_blank', 'noopener')}>Open in new tab</Button>}
        <Button variant="secondary" icon={Download} onClick={download}>Download</Button>
        <Button onClick={onClose}>Close</Button>
      </>}>
      {error && <Alert tone="danger">{error}</Alert>}
      {!src && !error && <Loading text="Loading document..." />}
      {src && (ext === 'pdf'
        ? <iframe className="preview-frame" style={{ width: '100%', height: '70vh', border: 0 }} src={src} title={`Preview of ${file?.originalName}`} />
        : <img src={src} alt={file?.originalName} style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto' }} />)}
    </Modal>
  );
}

/** A file row: name, a View button (PDF and images) and a Download button. */
export function FileChip({ url, file, name }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const f = file || { originalName: name };
  return (
    <div className="file-chip">
      <span className="name">{f.originalName}</span>
      {canView(f) && <Button variant="secondary" size="sm" icon={Eye} onClick={() => setOpen(true)}>View</Button>}
      <Button variant="secondary" size="sm" icon={Download} onClick={() => downloadFile(url, f.originalName).catch((e) => toast.error(errMsg(e)))}>Download</Button>
      {open && <FileViewerDialog url={url} file={f} onClose={() => setOpen(false)} />}
    </div>
  );
}
