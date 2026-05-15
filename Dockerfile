FROM golang:1.26-alpine AS builder

WORKDIR /app

COPY go.mod ./
COPY go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o mindmap .

FROM alpine:3.21

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY --from=builder /app/mindmap .
COPY web/ ./web/

EXPOSE 8080

CMD ["./mindmap"]
