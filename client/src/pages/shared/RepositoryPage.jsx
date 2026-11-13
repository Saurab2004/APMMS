import { useState } from 'react';
import { Library, Plus, Download, Archive, ArchiveRestore, FileText } from 'lucide-react';
import { Badge, Button, Card, CardBody, EmptyState, PageHeader } from '../../components/common/ui.jsx';
import DataState from '../../components/common/DataState.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { FileInput, Field, Input, Select, TextArea } from '../../components/forms/fields.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useForm } from '../../hooks/useForm.js';
import { api, downloadFile, errMsg, get, patch } from '../../services/api.js';
import { fmtBytes, fmtDate, titleCase } from '../../utils/format.js';

function Upload({ onClose, onSaved }) {
  const toast = useToast();
  const deps = useAsync(() => get('/departments'), []);
  const f = useForm({ title: '', description: '', category: 'template', visibility: 'all', departmentId: '' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!files[0]) return toast.error('Choose a file');
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f.values).forEach(([k, v]) => v && fd.append(k, v));
      fd.append('file', files[0]);
      await api.post('/repository', fd);
      toast.success('Added to the repository'); onSaved();
    } catch (err) { f.applyError(err); toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a resource" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="repo-form" loading={busy}>Upload</Button></>}>
      <form id="repo-form" className="stack" onSubmit={submit}>
        <Field label="Title" required error={f.errors.title}><Input {...f.bind('title')} required /></Field>
        <Field label="Description"><TextArea {...f.bind('description')} rows={2} /></Field>
        <div className="form-grid">
          <Field label="Category"><Select {...f.bind('category')}>{['template', 'guideline', 'rubric', 'sample', 'other'].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select></Field>
          <Field label="Visible to"><Select {...f.bind('visibility')}><option value="all">Everyone</option><option value="students">Students</option><option value="supervisors">Supervisors</option></Select></Field>
          <Field label="Department" className="span-2"><Select {...f.bind('departmentId')}><option value="">All departments</option>{(deps.data || []).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
        </div>
        <FileInput label="File" accept={['pdf', 'docx', 'pptx', 'xlsx', 'zip', 'png', 'jpg', 'txt']} files={files} onChange={setFiles} error={f.errors.file} />
      </form>
    </Modal>
  );
}

export default function RepositoryPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isCoord = user.role === 'coordinator';
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const state = useAsync(() => get('/repository', { category: category || undefined, archived: archived ? '1' : undefined }), [category, archived]);

  const toggle = async (r) => { try { await patch(`/repository/${r._id}/archive`, { isArchived: !r.isArchived }); state.reload(); } catch (e) { toast.error(errMsg(e)); } };
  const rows = (state.data || []).filter((r) => archived ? true : !r.isArchived);

  return (
    <>
      <PageHeader title="Project repository" subtitle="Templates, guidelines, rubrics and samples shared by the coordinator." actions={isCoord && <Button icon={Plus} onClick={() => setAdding(true)}>Add resource</Button>} />
      <div className="filters">
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>{['template', 'guideline', 'rubric', 'sample', 'other'].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
        </Select>
        {isCoord && <label className="check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Show archived</label>}
      </div>
      <DataState loading={state.loading} error={state.error} rows={state.data} onRetry={state.reload} empty={<Card><EmptyState icon={Library} title="The repository is empty">{isCoord ? 'Add templates and guidelines for students and supervisors.' : 'Resources shared by the coordinator will appear here.'}</EmptyState></Card>}>
        <div className="grid auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {rows.map((r) => (
            <Card key={r._id}>
              <CardBody className="stack-sm">
                <div className="row between"><Badge tone="indigo">{titleCase(r.category)}</Badge>{r.isArchived && <Badge>Archived</Badge>}</div>
                <h3 className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><FileText size={18} style={{ flex: 'none' }} /><span style={{ overflowWrap: 'anywhere' }}>{r.title}</span></h3>
                {r.description && <p className="muted small" style={{ margin: 0 }}>{r.description}</p>}
                <div className="muted small">{r.file.originalName} - {fmtBytes(r.file.size)}<br />Added {fmtDate(r.createdAt)}{r.department ? ` - ${r.department.code}` : ''}{isCoord ? ` - ${r.visibility}` : ''}</div>
                <div className="row">
                  <Button variant="secondary" size="sm" icon={Download} onClick={() => downloadFile(`/repository/${r._id}/download`, r.file.originalName).catch((e) => toast.error(errMsg(e)))}>Download</Button>
                  {isCoord && <Button variant="ghost" size="sm" icon={r.isArchived ? ArchiveRestore : Archive} onClick={() => toggle(r)}>{r.isArchived ? 'Restore' : 'Archive'}</Button>}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </DataState>
      {adding && <Upload onClose={() => setAdding(false)} onSaved={() => { setAdding(false); state.reload(); }} />}
    </>
  );
}
