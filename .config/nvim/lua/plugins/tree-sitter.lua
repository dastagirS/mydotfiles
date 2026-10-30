return {
	{
		"nvim-treesitter/nvim-treesitter",
		branch = "main",
		lazy = false,
		build = function()
			require("nvim-treesitter").install({ "all" }):wait(300000)
		end,
		config = function()
			require("nvim-treesitter").setup({
				install_dir = vim.fn.stdpath("data") .. "/site",
			})

			local ensure = {
				"lua", "go", "python", "javascript", "typescript",
				"tsx", "html", "css", "json", "yaml", "toml",
				"rust", "dart", "bash", "markdown", "markdown_inline",
				"vim", "vimdoc",
			}
			require("nvim-treesitter").install(ensure)
		end,
	},
	{
		-- Enable treesitter features per filetype via FileType autocmd
		-- (new main branch does not auto-enable these — must be done manually)
		name = "treesitter-config",
		dir = vim.fn.stdpath("config"),
		lazy = false,
		config = function()
			local langs = {
				"lua", "go", "python", "javascript", "typescript", "tsx",
				"html", "css", "json", "yaml", "toml", "rust", "dart",
				"bash", "markdown", "markdown_inline", "vim", "vimdoc",
			}

			vim.api.nvim_create_autocmd("FileType", {
				pattern = langs,
				callback = function(ev)
					-- Guard: only start if parser is available
					if vim.treesitter.language.add(vim.bo[ev.buf].filetype) then
						vim.treesitter.start(ev.buf)
						vim.bo[ev.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
					end
				end,
			})
		end,
	},
}
