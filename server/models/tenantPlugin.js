// Multi-institution isolation, enforced in one place.
// Every model gets an `institution` field. While a request is being handled (see utils/tenant.js) every
// find / count / update / delete / aggregate on these models is automatically restricted to the caller's
// institution, and every new document is stamped with it. A controller therefore cannot forget the filter.
import mongoose from 'mongoose';
import { currentInstitution } from '../utils/tenant.js';

const QUERY_OPS = [
  'find', 'findOne', 'countDocuments', 'distinct', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'replaceOne',
];

export function tenantPlugin(schema) {
  if (schema.options.tenant === false) return; // the Institution model itself
  schema.add({ institution: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', index: true } });

  schema.pre(QUERY_OPS, function limitToInstitution() {
    const inst = currentInstitution();
    if (inst) this.where({ institution: inst });
  });

  schema.pre('aggregate', function limitAggregate() {
    const inst = currentInstitution();
    if (inst) this.pipeline().unshift({ $match: { institution: new mongoose.Types.ObjectId(inst) } });
  });

  schema.pre('insertMany', function stampMany(next, docs) {
    const inst = currentInstitution();
    if (inst) for (const d of Array.isArray(docs) ? docs : [docs]) if (d && !d.institution) d.institution = inst;
    next();
  });

  // New documents get the caller's institution. A missing institution is a programming error: fail loudly
  // instead of silently saving a record nobody (or everybody) can see.
  schema.pre('validate', function stampInstitution(next) {
    if (!this.institution) {
      const inst = currentInstitution();
      if (inst) this.institution = inst;
    }
    if (!this.institution) return next(new Error(`${this.constructor.modelName}: institution is missing`));
    next();
  });
}

mongoose.plugin(tenantPlugin, { applyPluginsToChildSchemas: false }); // only real models, not embedded sub-schemas
