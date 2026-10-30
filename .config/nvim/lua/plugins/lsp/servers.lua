local M = {}

function M.setup()
	local capabilities = require("blink.cmp").get_lsp_capabilities()
	local lspconfig = require("lspconfig")

	-- Configure diagnostic display
	vim.diagnostic.config({
		virtual_text = true,
		signs = true,
		underline = true,
		update_in_insert = false,
		severity_sort = true,
		float = {
			border = "rounded",
			source = true,
		},
	})

	-- TypeScript/JavaScript
	lspconfig.ts_ls.setup({
		capabilities = capabilities,
		root_dir = lspconfig.util.root_pattern("package.json", "tsconfig.json"),
		single_file_support = false,
	})

	-- Deno
	lspconfig.denols.setup({
		capabilities = capabilities,
		root_dir = lspconfig.util.root_pattern("deno.json", "deno.jsonc"),
		single_file_support = false,
	})

	-- Python
	lspconfig.basedpyright.setup({
		capabilities = capabilities,
	})

	-- Go
	lspconfig.gopls.setup({
		capabilities = capabilities,
		settings = {
			gopls = {
				analyses = {
					unusedparams = true,
					shadow = true,
					nilness = true,
					unusedwrite = true,
					useany = true,
				},
				staticcheck = true,
				completeUnimported = true,
				usePlaceholders = true,
				hints = {
					assignVariableTypes = true,
					compositeLiteralFields = true,
					constantValues = true,
					functionTypeParameters = true,
					parameterNames = true,
					rangeVariableTypes = true,
				},
			},
		},
	})

	-- HTML
	lspconfig.html.setup({
		capabilities = capabilities,
	})

	-- Prisma
	lspconfig.prismals.setup({
		capabilities = capabilities,
	})

	-- Rust
	lspconfig.rust_analyzer.setup({
		capabilities = capabilities,
	})

	-- Tailwind CSS
	lspconfig.tailwindcss.setup({
		capabilities = capabilities,
	})

	-- Bash
	lspconfig.bashls.setup({
		capabilities = capabilities,
	})

	-- LSP keymaps: buffer-local, only active when an LSP is attached
	local group = vim.api.nvim_create_augroup("UserLspKeymaps", { clear = true })
	vim.api.nvim_create_autocmd("LspAttach", {
		group = group,
		callback = function(event)
			local opts = { buffer = event.buf }
			vim.keymap.set("n", "K", vim.lsp.buf.hover, opts)
			vim.keymap.set("n", "<leader>gd", vim.lsp.buf.definition, opts)
			vim.keymap.set("n", "<leader>gr", vim.lsp.buf.references, opts)
			vim.keymap.set("n", "<leader>ca", vim.lsp.buf.code_action, opts)
			vim.keymap.set("n", "<leader>cd", vim.diagnostic.open_float, opts)
			vim.keymap.set("n", "<leader>cr", "<cmd>LspRestart<cr>", { buffer = event.buf, desc = "[C]ode LSP [R]estart" })
		end,
	})

end

return M
