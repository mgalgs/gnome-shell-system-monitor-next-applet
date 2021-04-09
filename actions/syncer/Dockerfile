FROM debian:buster-20210329

RUN apt update && apt install -y git

COPY . /app
CMD ["/app/run.sh"]
