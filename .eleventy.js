module.exports = function (eleventyConfig) {
	// Passthrough static assets and hero images
	eleventyConfig.addPassthroughCopy('src/assets')
	eleventyConfig.addPassthroughCopy('src/_includes')
	return {
		dir: {
			input: 'src',
			output: '_site',
		},
	}
}

