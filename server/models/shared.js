import './tenantPlugin.js';
import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Metadata for a file that lives on disk (never the file itself, never Base64). */
export const fileSchema = new Schema(
  {
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    storagePath: { type: String, required: true },
    mimeType: { type: String },
    size: { type: Number },
    extension: { type: String },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);
