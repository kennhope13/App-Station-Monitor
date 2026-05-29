# ============================================================
# Dockerfile — Đóng gói StationOS Backend (ARM64/x64)
# Multi-stage build để tối ưu dung lượng image.
# ============================================================

# STAGE 1: Build & Restore
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy csproj trước để tận dụng cache layer khi restore
COPY ["StationOS.sln", "./"]
COPY ["StationOS.Api/StationOS.Api.csproj",                "StationOS.Api/"]
COPY ["StationOS.Data/StationOS.Data.csproj",              "StationOS.Data/"]
COPY ["StationOS.Services/StationOS.Services.csproj",      "StationOS.Services/"]
COPY ["StationOS.Workers/StationOS.Workers.csproj",        "StationOS.Workers/"]
COPY ["StationOS.Analytics/StationOS.Analytics.csproj",    "StationOS.Analytics/"]
COPY ["StationOS.Simulators/StationOS.Simulators.csproj",  "StationOS.Simulators/"]
COPY ["StationOS.Tests/StationOS.Tests.csproj",            "StationOS.Tests/"]

# Restore NuGet — chỉ restore API + dependencies, bỏ Tests/Simulators trong production
RUN dotnet restore "StationOS.Api/StationOS.Api.csproj"

# Copy mã nguồn còn lại
COPY . .

# Build & publish ra /app/publish
WORKDIR "/src/StationOS.Api"
RUN dotnet publish "StationOS.Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

# STAGE 2: Runtime
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app

# Native deps:
#   - ffmpeg:        record + concat clip video event
#   - iputils-ping:  AutoDiscovery (ping subnet scan)
#   - libsnap7-dev:  Siemens S7 communication (PLC)
#   - curl:          health check
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    iputils-ping \
    libsnap7-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=publish /app/publish .

# Port mặc định (docker-compose có thể override qua ASPNETCORE_URLS env)
EXPOSE 5000
ENV ASPNETCORE_URLS=http://+:5000

ENTRYPOINT ["dotnet", "StationOS.Api.dll"]
