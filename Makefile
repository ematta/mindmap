.PHONY: all build test run clean fmt

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
