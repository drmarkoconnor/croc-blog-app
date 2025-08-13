module.exports = function (eleventyConfig) {
	// Passthrough static assets and hero images
	eleventyConfig.addPassthroughCopy({ 'src/assets': 'assets' })
	// Expose quotes.json for client-side fetch
	eleventyConfig.addPassthroughCopy({ 'src/_data/quotes.json': 'quotes.json' })
	// Not required to copy includes, but harmless if left out
	return {
		dir: {
			input: 'src/pages',
			includes: '../_includes',
			data: '../_data',
			output: '_site',
		},
	}
}

