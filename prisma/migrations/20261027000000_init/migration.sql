BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[City] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [countryCode] NVARCHAR(1000) NOT NULL,
    [lat] FLOAT(53) NOT NULL,
    [lon] FLOAT(53) NOT NULL,
    [background] NVARCHAR(max),
    [tourismBoard] NVARCHAR(max),
    [refreshedAt] DATETIME2 NOT NULL,
    CONSTRAINT [City_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [City_name_countryCode_key] UNIQUE NONCLUSTERED ([name],[countryCode])
);

-- CreateTable
CREATE TABLE [dbo].[Poi] (
    [id] NVARCHAR(1000) NOT NULL,
    [cityId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [category] NVARCHAR(1000) NOT NULL,
    [lat] FLOAT(53) NOT NULL,
    [lon] FLOAT(53) NOT NULL,
    [hours] NVARCHAR(max),
    [sourceUrl] NVARCHAR(1000),
    CONSTRAINT [Poi_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Trip] (
    [id] NVARCHAR(1000) NOT NULL,
    [ownerId] NVARCHAR(1000) NOT NULL,
    [cityId] NVARCHAR(1000),
    [cityName] NVARCHAR(1000) NOT NULL,
    [countryCode] NVARCHAR(1000),
    [days] INT NOT NULL,
    [startDate] DATETIME2,
    [style] NVARCHAR(1000) NOT NULL,
    [transport] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL,
    [progress] INT NOT NULL CONSTRAINT [Trip_progress_df] DEFAULT 0,
    [errorMessage] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Trip_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Trip_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TripDay] (
    [id] NVARCHAR(1000) NOT NULL,
    [tripId] NVARCHAR(1000) NOT NULL,
    [dayIndex] INT NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [stops] NVARCHAR(max) NOT NULL,
    [routeGeo] NVARCHAR(max),
    CONSTRAINT [TripDay_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TripDay_tripId_dayIndex_key] UNIQUE NONCLUSTERED ([tripId],[dayIndex])
);

-- CreateTable
CREATE TABLE [dbo].[NearbyTown] (
    [id] NVARCHAR(1000) NOT NULL,
    [tripId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [travelMins] INT NOT NULL,
    [reason] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [NearbyTown_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[UsageLog] (
    [id] NVARCHAR(1000) NOT NULL,
    [date] DATE NOT NULL,
    [tripId] NVARCHAR(1000),
    [provider] NVARCHAR(1000) NOT NULL,
    [calls] INT NOT NULL CONSTRAINT [UsageLog_calls_df] DEFAULT 1,
    [inputTokens] INT NOT NULL CONSTRAINT [UsageLog_inputTokens_df] DEFAULT 0,
    [outputTokens] INT NOT NULL CONSTRAINT [UsageLog_outputTokens_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UsageLog_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [UsageLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Poi_cityId_idx] ON [dbo].[Poi]([cityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Trip_createdAt_idx] ON [dbo].[Trip]([createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Trip_cityId_idx] ON [dbo].[Trip]([cityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NearbyTown_tripId_idx] ON [dbo].[NearbyTown]([tripId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UsageLog_date_provider_idx] ON [dbo].[UsageLog]([date], [provider]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UsageLog_tripId_idx] ON [dbo].[UsageLog]([tripId]);

-- AddForeignKey
ALTER TABLE [dbo].[Poi] ADD CONSTRAINT [Poi_cityId_fkey] FOREIGN KEY ([cityId]) REFERENCES [dbo].[City]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Trip] ADD CONSTRAINT [Trip_cityId_fkey] FOREIGN KEY ([cityId]) REFERENCES [dbo].[City]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[TripDay] ADD CONSTRAINT [TripDay_tripId_fkey] FOREIGN KEY ([tripId]) REFERENCES [dbo].[Trip]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[NearbyTown] ADD CONSTRAINT [NearbyTown_tripId_fkey] FOREIGN KEY ([tripId]) REFERENCES [dbo].[Trip]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
