return {
	"folke/snacks.nvim",
	priority = 1000,
	lazy = false,
	config = function()
		local snacks = require("snacks")
		snacks.setup({
			picker = { enabled = true },
			notifier = { enabled = true },
			bigfile = { enabled = true },
		})

		-- Files
		vim.keymap.set("n", "<leader>sf", snacks.picker.files, { desc = "[S]earch [F]iles" })
		vim.keymap.set("n", "<leader>s.", snacks.picker.recent, { desc = "[S]earch Recent Files" })
		vim.keymap.set("n", "<leader><leader>", snacks.picker.buffers, { desc = "[ ] Find existing buffers" })
		vim.keymap.set("n", "<leader>sn", function()
			snacks.picker.files({ cwd = vim.fn.stdpath("config") })
		end, { desc = "[S]earch [N]eovim files" })

		-- Search
		vim.keymap.set("n", "<leader>sg", snacks.picker.grep, { desc = "[S]earch by [G]rep" })
		vim.keymap.set("n", "<leader>sw", snacks.picker.grep_word, { desc = "[S]earch current [W]ord" })
		vim.keymap.set("n", "<leader>/", snacks.picker.lines, { desc = "[/] Fuzzily search in current buffer" })
		vim.keymap.set("n", "<leader>s/", function()
			snacks.picker.grep({ buffers = true })
		end, { desc = "[S]earch [/] in Open Files" })

		-- LSP/Diagnostics
		vim.keymap.set("n", "<leader>sd", snacks.picker.diagnostics, { desc = "[S]earch [D]iagnostics" })

		-- Help and docs
		vim.keymap.set("n", "<leader>sh", snacks.picker.help, { desc = "[S]earch [H]elp" })
		vim.keymap.set("n", "<leader>sk", snacks.picker.keymaps, { desc = "[S]earch [K]eymaps" })
		vim.keymap.set("n", "<leader>ss", snacks.picker.pickers, { desc = "[S]earch [S]elect Picker" })

		-- Resume last picker
		vim.keymap.set("n", "<leader>sr", snacks.picker.resume, { desc = "[S]earch [R]esume" })
	end,
}
