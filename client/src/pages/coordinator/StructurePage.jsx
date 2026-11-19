import { Alert, PageHeader } from '../../components/common/ui.jsx';
import InstitutionStructure from '../platform/InstitutionStructure.jsx';

/** The institution coordinator builds the structure: faculties, departments and the coordinator of each department. */
export default function StructurePage() {
  return (
    <>
      <PageHeader title="Faculties & departments" subtitle="Add faculties and departments, invite the coordinator of each department by email, and delete what is not needed." />
      <Alert className="mb">A faculty can be deleted only when it has no departments. A department can be deleted only when it has no students, supervisors, batches or groups; otherwise deactivate it on the Departments page.</Alert>
      <InstitutionStructure mode="coordinator" />
    </>
  );
}
