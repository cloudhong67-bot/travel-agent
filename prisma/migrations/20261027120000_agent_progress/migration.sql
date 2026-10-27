BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Trip] ADD [meta] NVARCHAR(max),
[step] NVARCHAR(1000),
[stepMessage] NVARCHAR(1000),
[updatedAt] DATETIME2 NOT NULL CONSTRAINT [Trip_updatedAt_df] DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE NONCLUSTERED INDEX [Trip_status_updatedAt_idx] ON [dbo].[Trip]([status], [updatedAt]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
