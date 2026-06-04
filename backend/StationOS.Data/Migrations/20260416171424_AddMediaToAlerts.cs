using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StationOS.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMediaToAlerts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DetectionEvents_AiModelVersions_ModelVersionId",
                table: "DetectionEvents");

            migrationBuilder.DropColumn(
                name: "DetectionId",
                table: "MediaFiles");

            migrationBuilder.DropColumn(
                name: "DeviceId",
                table: "MediaFiles");

            migrationBuilder.DropColumn(
                name: "DurationS",
                table: "MediaFiles");

            migrationBuilder.DropColumn(
                name: "FilePath",
                table: "MediaFiles");

            migrationBuilder.DropColumn(
                name: "FileSizeKb",
                table: "MediaFiles");

            migrationBuilder.DropColumn(
                name: "FileType",
                table: "MediaFiles");

            migrationBuilder.DropColumn(
                name: "FileUrl",
                table: "MediaFiles");

            migrationBuilder.DropColumn(
                name: "Synced",
                table: "MediaFiles");

            migrationBuilder.DropColumn(
                name: "SyncedAt",
                table: "MediaFiles");

            migrationBuilder.DropColumn(
                name: "TakenBy",
                table: "MediaFiles");

            migrationBuilder.RenameColumn(
                name: "Storage",
                table: "MediaFiles",
                newName: "Path");

            migrationBuilder.RenameColumn(
                name: "StationId",
                table: "MediaFiles",
                newName: "CameraId");

            migrationBuilder.RenameColumn(
                name: "Source",
                table: "MediaFiles",
                newName: "MimeType");

            migrationBuilder.RenameColumn(
                name: "CapturedAt",
                table: "MediaFiles",
                newName: "CreatedAt");

            migrationBuilder.RenameColumn(
                name: "ModelVersionId",
                table: "DetectionEvents",
                newName: "MediaFileId");

            migrationBuilder.RenameIndex(
                name: "IX_DetectionEvents_ModelVersionId",
                table: "DetectionEvents",
                newName: "IX_DetectionEvents_MediaFileId");

            migrationBuilder.AddColumn<long>(
                name: "SizeBytes",
                table: "MediaFiles",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AlterColumn<float>(
                name: "Confidence",
                table: "DetectionEvents",
                type: "real",
                nullable: false,
                defaultValue: 0f,
                oldClrType: typeof(float),
                oldType: "real",
                oldNullable: true);

            migrationBuilder.AddColumn<float>(
                name: "BboxHeight",
                table: "DetectionEvents",
                type: "real",
                nullable: true);

            migrationBuilder.AddColumn<float>(
                name: "BboxWidth",
                table: "DetectionEvents",
                type: "real",
                nullable: true);

            migrationBuilder.AddColumn<float>(
                name: "BboxX",
                table: "DetectionEvents",
                type: "real",
                nullable: true);

            migrationBuilder.AddColumn<float>(
                name: "BboxY",
                table: "DetectionEvents",
                type: "real",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Label",
                table: "DetectionEvents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Message",
                table: "DetectionEvents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Severity",
                table: "DetectionEvents",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "DetectionEvents",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ThumbnailUrl",
                table: "Alerts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VideoUrl",
                table: "Alerts",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_DetectionEvents_AlertId",
                table: "DetectionEvents",
                column: "AlertId");

            migrationBuilder.CreateIndex(
                name: "IX_DetectionEvents_StationId",
                table: "DetectionEvents",
                column: "StationId");

            migrationBuilder.AddForeignKey(
                name: "FK_DetectionEvents_Alerts_AlertId",
                table: "DetectionEvents",
                column: "AlertId",
                principalTable: "Alerts",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_DetectionEvents_MediaFiles_MediaFileId",
                table: "DetectionEvents",
                column: "MediaFileId",
                principalTable: "MediaFiles",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_DetectionEvents_Stations_StationId",
                table: "DetectionEvents",
                column: "StationId",
                principalTable: "Stations",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DetectionEvents_Alerts_AlertId",
                table: "DetectionEvents");

            migrationBuilder.DropForeignKey(
                name: "FK_DetectionEvents_MediaFiles_MediaFileId",
                table: "DetectionEvents");

            migrationBuilder.DropForeignKey(
                name: "FK_DetectionEvents_Stations_StationId",
                table: "DetectionEvents");

            migrationBuilder.DropIndex(
                name: "IX_DetectionEvents_AlertId",
                table: "DetectionEvents");

            migrationBuilder.DropIndex(
                name: "IX_DetectionEvents_StationId",
                table: "DetectionEvents");

            migrationBuilder.DropColumn(
                name: "SizeBytes",
                table: "MediaFiles");

            migrationBuilder.DropColumn(
                name: "BboxHeight",
                table: "DetectionEvents");

            migrationBuilder.DropColumn(
                name: "BboxWidth",
                table: "DetectionEvents");

            migrationBuilder.DropColumn(
                name: "BboxX",
                table: "DetectionEvents");

            migrationBuilder.DropColumn(
                name: "BboxY",
                table: "DetectionEvents");

            migrationBuilder.DropColumn(
                name: "Label",
                table: "DetectionEvents");

            migrationBuilder.DropColumn(
                name: "Message",
                table: "DetectionEvents");

            migrationBuilder.DropColumn(
                name: "Severity",
                table: "DetectionEvents");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "DetectionEvents");

            migrationBuilder.DropColumn(
                name: "ThumbnailUrl",
                table: "Alerts");

            migrationBuilder.DropColumn(
                name: "VideoUrl",
                table: "Alerts");

            migrationBuilder.RenameColumn(
                name: "Path",
                table: "MediaFiles",
                newName: "Storage");

            migrationBuilder.RenameColumn(
                name: "MimeType",
                table: "MediaFiles",
                newName: "Source");

            migrationBuilder.RenameColumn(
                name: "CreatedAt",
                table: "MediaFiles",
                newName: "CapturedAt");

            migrationBuilder.RenameColumn(
                name: "CameraId",
                table: "MediaFiles",
                newName: "StationId");

            migrationBuilder.RenameColumn(
                name: "MediaFileId",
                table: "DetectionEvents",
                newName: "ModelVersionId");

            migrationBuilder.RenameIndex(
                name: "IX_DetectionEvents_MediaFileId",
                table: "DetectionEvents",
                newName: "IX_DetectionEvents_ModelVersionId");

            migrationBuilder.AddColumn<Guid>(
                name: "DetectionId",
                table: "MediaFiles",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeviceId",
                table: "MediaFiles",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DurationS",
                table: "MediaFiles",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FilePath",
                table: "MediaFiles",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FileSizeKb",
                table: "MediaFiles",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FileType",
                table: "MediaFiles",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "FileUrl",
                table: "MediaFiles",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "Synced",
                table: "MediaFiles",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "SyncedAt",
                table: "MediaFiles",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "TakenBy",
                table: "MediaFiles",
                type: "uuid",
                nullable: true);

            migrationBuilder.AlterColumn<float>(
                name: "Confidence",
                table: "DetectionEvents",
                type: "real",
                nullable: true,
                oldClrType: typeof(float),
                oldType: "real");

            migrationBuilder.AddForeignKey(
                name: "FK_DetectionEvents_AiModelVersions_ModelVersionId",
                table: "DetectionEvents",
                column: "ModelVersionId",
                principalTable: "AiModelVersions",
                principalColumn: "Id");
        }
    }
}
