# File Upload System (Supabase Storage)

## Overview

The Carbon project uses Supabase Storage for file uploads (documents, models, attachments). Files are uploaded to Supabase Storage buckets and metadata is tracked in the `document` table.

## ⚠️ Critical: Server-Side Upload Pattern

**All storage operations MUST go through server-side endpoints.** Client-side Supabase Storage API calls fail due to RLS issues.

### Why Client-Side Uploads Fail

The self-hosted Supabase Storage API does not properly propagate the user's JWT context to Postgres, causing `auth.uid()` to be NULL in RLS policy evaluation. This results in:
- Upload failures with "new row violates row-level security policy"
- Silent failures where upload appears to succeed but file is not accessible
- List operations returning empty results

### The Solution: Server-Side Endpoints

All storage operations are routed through server-side API endpoints that use the **service role** (which has `BYPASSRLS` permission):

| Endpoint | Purpose | File |
|----------|---------|------|
| `/api/storage/upload` | Upload files | `apps/erp/app/routes/api+/storage.upload.ts` |
| `/api/storage/remove` | Delete files | `apps/erp/app/routes/api+/storage.remove.ts` |

### Client Helper Functions

Use these helper functions in components:

```typescript
import { serverStorageUpload, serverStorageRemove } from "~/utils/storage";

// Upload a file
const result = await serverStorageUpload(file, storagePath, {
  bucket: "private",           // default: "private"
  cacheControl: "43200",       // optional, default: "3600"
  contentType: "application/pdf", // optional
  upsert: true                 // optional, default: true
});

if (result.error) {
  toast.error(`Upload failed: ${result.error.message}`);
} else {
  // result.data.path contains the stored path
}

// Delete files
const removeResult = await serverStorageRemove([path1, path2], "private");
```

### Response Format

Both functions return:
```typescript
type StorageResult = {
  data?: { path: string } | { path: string }[];
  error?: { message: string };
};
```

## Key Files

### Server-Side API Routes
- `apps/erp/app/routes/api+/storage.upload.ts` - Generic storage upload endpoint
- `apps/erp/app/routes/api+/storage.remove.ts` - Generic storage remove endpoint
- `apps/erp/app/routes/api+/document.upload.ts` - Document upload with metadata
- `apps/erp/app/routes/api+/model.upload.ts` - 3D model upload endpoint

### Client Utilities
- `apps/erp/app/utils/storage.ts` - `serverStorageUpload`, `serverStorageRemove` helpers
- `apps/erp/app/utils/path.ts` - API path definitions (`path.to.api.storageUpload`)

### Components Using Server-Side Upload
| Component | File | Operations |
|-----------|------|------------|
| `DefaultAttachmentsPanel` | `apps/erp/app/components/DefaultAttachmentsPanel.tsx` | Upload, Delete |
| `Documents` | `apps/erp/app/components/Documents.tsx` | Upload, Delete |
| `AttachmentsList` | `apps/erp/app/components/AttachmentsList.tsx` | Upload, Delete |
| `MaintenanceDispatchNotes` | `apps/erp/app/modules/resources/ui/Maintenance/MaintenanceDispatchNotes.tsx` | Upload, Delete |
| `InspectionDocumentEditor` | `apps/erp/app/modules/quality/ui/InspectionDocument/InspectionDocumentEditor.tsx` | Upload (PDF) |
| `ItemNotes`, `BillOfProcess`, etc. | Various | Upload |

### Loaders Using Service Role for List Operations

When listing files from storage in loaders, use the service role to bypass RLS:

```typescript
import { getCarbonServiceRole } from "@carbon/auth/client.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // ... auth checks ...
  
  // Use service role for listing files
  const serviceRole = getCarbonServiceRole();
  const result = await serviceRole.storage
    .from("private")
    .list(`${companyId}/some/path`);
  
  return { files: result.data ?? [] };
}
```

**Pages using this pattern:**
- `apps/erp/app/routes/x+/maintenance+/$dispatchId.tsx` - `getMaintenanceDispatchFiles()`
- `apps/erp/app/routes/x+/settings+/purchasing.tsx` - Default attachments listing

## Auth/Permission Flow

- `requirePermissions()` in `packages/auth/src/services/auth.server.ts` handles auth
- Calls `requireAuthSession()` → `verifyAuthSession()` → `getUserClaims()`
- `getUserClaims()` caches permissions in Redis via `getPermissionCacheKey(userId)`
- The storage upload/remove endpoints use `requirePermissions(request, {})` (empty permissions = any authenticated user)
- The actual Supabase operation uses service role which bypasses RLS

## Common Issues & Fixes

### ✅ RESOLVED: Upload fails with "Failed to get claims"
- **Cause**: `getUserClaims()` throws when Redis cache miss and DB query fails
- **Fix (commits 2df553a7f / eee322dff / 319bd3740)**: Server routes use user JWT directly for DB ops

### ✅ RESOLVED: Client-side storage uploads fail with RLS error
- **Cause**: Self-hosted Supabase Storage doesn't propagate JWT to Postgres, `auth.uid()` is NULL
- **Fix**: All uploads routed through server-side endpoints using service role (BYPASSRLS)
- **Migration**: `20260701000001_service_role_bypass_rls.sql` grants BYPASSRLS to service role

### ✅ RESOLVED: Upload succeeds but file doesn't appear in list
- **Cause**: List operations using regular client also affected by RLS issues
- **Fix**: Use `getCarbonServiceRole()` for storage list operations in loaders

### ✅ RESOLVED: Dev server crashes with exit code 3221226505
- **Cause**: Stack buffer overrun from various issues during file operations
- **Fix**: Server-side upload pattern eliminates problematic client-side operations

### ✅ RESOLVED: Error format mismatch between client and server
- **Cause**: Server returned `{ error: "string" }` but client expected `{ error: { message: "string" } }`
- **Fix**: Standardized error format to `{ error: { message: string } }` in both endpoints

## ❌ Anti-Pattern: DO NOT USE

```typescript
// WRONG - This will fail due to RLS issues
const { carbon } = useCarbon();
const result = await carbon.storage
  .from("private")
  .upload(path, file);

// WRONG - This will return empty results
const result = await client.storage
  .from("private")
  .list(path);
```

## ✅ Correct Pattern

```typescript
// CORRECT - Use server-side helper
import { serverStorageUpload } from "~/utils/storage";
const result = await serverStorageUpload(file, path, { bucket: "private" });

// CORRECT - Use service role in loaders
import { getCarbonServiceRole } from "@carbon/auth/client.server";
const serviceRole = getCarbonServiceRole();
const result = await serviceRole.storage.from("private").list(path);
```

## Debugging Tips

1. Check browser network tab for `/api/storage/upload` request/response
2. Check server logs for `[storage.upload] Failed:` messages
3. Verify the storage path format: `${companyId}/${module}/${id}/${filename}`
4. Check that `serverStorageUpload` is being used (not direct `carbon.storage`)
5. For list operations, verify service role is being used in loaders

## Related Cache Files

- `llm/cache/authentication-system.md` - Auth system overview
- `llm/cache/storage-placement-tracking.md` - Storage unit placement (different from file storage!)
- `llm/cache/inventory-storage-fix.md` - Inventory storage system fix

## Changelog

### 2026-07-07
- Fixed `InspectionDocumentEditor.tsx` PDF upload to use `serverStorageUpload`
- Fixed `DefaultAttachmentsPanel.tsx` to use server-side upload/delete
- Fixed `Documents.tsx` to use server-side upload/delete
- Fixed `AttachmentsList.tsx` to use server-side upload/delete
- Fixed `MaintenanceDispatchNotes.tsx` to use server-side upload/delete
- Fixed maintenance dispatch loader to use service role for file listing
- Fixed purchasing settings loader to use service role for file listing
- Standardized error format between client and server endpoints
- Improved HTTP error handling in `serverStorageUpload`/`serverStorageRemove`
