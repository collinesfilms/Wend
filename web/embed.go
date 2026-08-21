// Package web carries the built admin interface into the binary, so the
// deployed artefact is a single file with no assets to ship alongside it.
package web

import "embed"

//go:embed all:dist
var Dist embed.FS
