-- File library: folders, and folder/description on files.
CREATE TABLE "FileFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "FileFolder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FileFolder_parentId_idx" ON "FileFolder"("parentId");
ALTER TABLE "FileFolder" ADD CONSTRAINT "FileFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FileFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Two live folders with the same name in the same place would be confusing; names compare without case.
CREATE UNIQUE INDEX "FileFolder_parent_name_live" ON "FileFolder"(COALESCE("parentId", ''), lower("name")) WHERE "deletedAt" IS NULL;

ALTER TABLE "FileObject" ADD COLUMN "folderId" TEXT;
ALTER TABLE "FileObject" ADD COLUMN "description" TEXT;
CREATE INDEX "FileObject_folderId_idx" ON "FileObject"("folderId");
CREATE INDEX "FileObject_category_createdAt_idx" ON "FileObject"("category", "createdAt");
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "FileFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
