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
            // Migration AddDeviceCapabilities trước đó thiếu Designer.cs nên có thể bị skip.
            // Defensive: tạo cột Capabilities nếu chưa có, sau đó mới ALTER type.
            migrationBuilder.Sql(@"ALTER TABLE ""Devices"" ADD COLUMN IF NOT EXISTS ""Capabilities"" text;");

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
