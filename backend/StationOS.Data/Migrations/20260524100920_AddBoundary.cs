using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StationOS.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBoundary : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Boundaries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Type = table.Column<string>(type: "text", nullable: false),
                    PolygonJson = table.Column<string>(type: "jsonb", nullable: false),
                    SeverityLevel = table.Column<string>(type: "text", nullable: false),
                    ThresholdsJson = table.Column<string>(type: "jsonb", nullable: true),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Boundaries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Boundaries_Devices_DeviceId",
                        column: x => x.DeviceId,
                        principalTable: "Devices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Boundaries_DeviceId_Type",
                table: "Boundaries",
                columns: new[] { "DeviceId", "Type" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Boundaries");
        }
    }
}
