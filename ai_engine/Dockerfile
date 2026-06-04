FROM python:3.11-slim

# OpenCV cần libGL
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# YOLOv8n tự download lần đầu vào thư mục models/
ENV YOLO_MODEL=/app/models/yolov8n.pt

EXPOSE 8100
CMD ["python", "main.py"]
