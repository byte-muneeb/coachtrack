BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Student] (
    [id] INT NOT NULL IDENTITY(1,1),
    [registryId] NVARCHAR(1000) NOT NULL,
    [fullName] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000),
    [phone] NVARCHAR(1000),
    [dateOfBirth] DATETIME2,
    [address] NVARCHAR(1000),
    [guardianName] NVARCHAR(1000),
    [guardianRelation] NVARCHAR(1000),
    [photoUrl] NVARCHAR(1000),
    [course] NVARCHAR(1000),
    [batch] NVARCHAR(1000),
    [commencementDate] DATETIME2,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Student_status_df] DEFAULT 'active',
    [discountPct] FLOAT(53) NOT NULL CONSTRAINT [Student_discountPct_df] DEFAULT 0,
    [scholarship] FLOAT(53) NOT NULL CONSTRAINT [Student_scholarship_df] DEFAULT 0,
    [totalFee] FLOAT(53) NOT NULL CONSTRAINT [Student_totalFee_df] DEFAULT 0,
    [outstanding] FLOAT(53) NOT NULL CONSTRAINT [Student_outstanding_df] DEFAULT 0,
    [notes] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Student_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Student_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Student_registryId_key] UNIQUE NONCLUSTERED ([registryId])
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
