package web

import (
	"strings"
)

// routeNode represents a single segment in the route trie
type routeNode struct {
	children      map[string]*routeNode
	paramChild    *routeNode
	wildcardChild *routeNode
	paramName     string
	handler       map[string]Handler
	isWildcard    bool
}

// Router manages route registration and matching
type Router struct {
	root *routeNode
}

// NewRouter creates a new Router
func NewRouter() *Router {
	return &Router{
		root: &routeNode{
			children: make(map[string]*routeNode),
			handler:  make(map[string]Handler),
		},
	}
}

// Add registers a handler for a method and path
func (r *Router) Add(method, path string, handler Handler) {
	segments := splitPath(path)
	node := r.root

	for _, seg := range segments {
		if seg == "" {
			continue
		}

		if seg == "*" {
			// Wildcard - matches remaining path
			if node.wildcardChild == nil {
				node.wildcardChild = &routeNode{
					children:   make(map[string]*routeNode),
					handler:    make(map[string]Handler),
					isWildcard: true,
				}
			}
			node = node.wildcardChild
		} else if strings.HasPrefix(seg, ":") {
			// Parameter segment
			if node.paramChild == nil {
				node.paramChild = &routeNode{
					children:  make(map[string]*routeNode),
					handler:   make(map[string]Handler),
					paramName: seg[1:],
				}
			}
			node = node.paramChild
		} else {
			// Static segment
			if node.children[seg] == nil {
				node.children[seg] = &routeNode{
					children: make(map[string]*routeNode),
					handler:  make(map[string]Handler),
				}
			}
			node = node.children[seg]
		}
	}

	node.handler[method] = handler
}

// Match finds a handler for the given method and path
func (r *Router) Match(method, path string) (Handler, map[string]string) {
	segments := splitPath(path)
	params := make(map[string]string)

	handler := r.matchNode(r.root, method, segments, 0, params)
	if handler != nil {
		return handler, params
	}

	return nil, nil
}

func (r *Router) matchNode(node *routeNode, method string, segments []string, idx int, params map[string]string) Handler {
	if idx == len(segments) {
		if h, ok := node.handler[method]; ok {
			return h
		}
		// Try HEAD for GET
		if method == "HEAD" {
			if h, ok := node.handler["GET"]; ok {
				return h
			}
		}
		return nil
	}

	seg := segments[idx]

	// 1. Try static match
	if child, ok := node.children[seg]; ok {
		if h := r.matchNode(child, method, segments, idx+1, params); h != nil {
			return h
		}
	}

	// 2. Try parameter match
	if node.paramChild != nil {
		params[node.paramChild.paramName] = seg
		if h := r.matchNode(node.paramChild, method, segments, idx+1, params); h != nil {
			return h
		}
		delete(params, node.paramChild.paramName)
	}

	// 3. Try wildcard match
	if node.wildcardChild != nil {
		if h, ok := node.wildcardChild.handler[method]; ok {
			return h
		}
	}

	return nil
}

func splitPath(path string) []string {
	path = strings.TrimSpace(path)
	if path == "" || path == "/" {
		return []string{}
	}
	path = strings.Trim(path, "/")
	return strings.Split(path, "/")
}
