using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StationOS.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRoiPoints : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RoiPoints",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Tx = table.Column<float>(type: "real", nullable: false),
                    Ty = table.Column<float>(type: "real", nullable: false),
                    Ox = table.Column<float>(type: "real", nullable: false),
                    Oy = table.Column<float>(type: "real", nullable: false),
                    PreAlarmThreshold = table.Column<float>(type: "real", nullable: false),
                    AlarmThreshold = table.Column<float>(type: "real", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoiPoints", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RoiPoints_Devices_DeviceId",
                        column: x => x.DeviceId,
                        principalTable: "Devices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RoiPoints_DeviceId",
                table: "RoiPoints",
                column: "DeviceId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RoiPoints");
        }
    }
}
