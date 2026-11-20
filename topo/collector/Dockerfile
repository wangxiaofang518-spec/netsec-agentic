FROM python:3.12-slim

# 只装一个第三方依赖：requests
RUN pip install --no-cache-dir requests==2.32.3

WORKDIR /app
COPY app.py /app/app.py

# web/ 在运行时由 compose bind-mount 进来（便于改前端不重建镜像）
ENV WEB_DIR=/app/web \
    HTTP_PORT=8080 \
    POLL_INTERVAL=30 \
    ES_URL=http://elasticsearch:9200

EXPOSE 8080
CMD ["python", "-u", "app.py"]
