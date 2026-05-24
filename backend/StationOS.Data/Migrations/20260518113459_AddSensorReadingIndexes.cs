using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StationOS.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSensorReadingIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Capabilities",
                table: "Devices",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "jsonb",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SensorReadings_DeviceId_PointId_Time",
                table: "SensorReadings",
                columns: new[] { "DeviceId", "PointId", "Time" });

            migrationBuilder.CreateIndex(
                name: "IX_SensorReadings_StationId_Time",
                table: "SensorReadings",
                columns: new[] { "StationId", "Time" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SensorReadings_DeviceId_PointId_Time",
                table: "SensorReadings");

            migrationBuilder.DropIndex(
                name: "IX_SensorReadings_StationId_Time",
                table: "SensorReadings");

            migrationBuilder.AlterColumn<string>(
                name: "Capabilities",
                table: "Devices",
                type: "jsonb",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);
        }
    }
}
