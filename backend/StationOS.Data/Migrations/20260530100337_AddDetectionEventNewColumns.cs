using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StationOS.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDetectionEventNewColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "BoundaryId",
                table: "DetectionEvents",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BoundaryId",
                table: "Alerts",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_DetectionEvents_BoundaryId",
                table: "DetectionEvents",
                column: "BoundaryId");

            migrationBuilder.AddForeignKey(
                name: "FK_DetectionEvents_Boundaries_BoundaryId",
                table: "DetectionEvents",
                column: "BoundaryId",
                principalTable: "Boundaries",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DetectionEvents_Boundaries_BoundaryId",
                table: "DetectionEvents");

            migrationBuilder.DropIndex(
                name: "IX_DetectionEvents_BoundaryId",
                table: "DetectionEvents");

            migrationBuilder.DropColumn(
                name: "BoundaryId",
                table: "DetectionEvents");

            migrationBuilder.DropColumn(
                name: "BoundaryId",
                table: "Alerts");
        }
    }
}
