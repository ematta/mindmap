.PHONY: all build test run clean fmt docker-up docker-down

BINARY := mindmap
PORT := 8080

all: fmt test build

build:
	go build -o $(BINARY) .

test:
	go test ./pkg/web/ -v -count=1

run:
	PORT=$(PORT) go run main.go

clean:
	rm -f $(BINARY)

fmt:
	gofmt -l -s -w .

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down
