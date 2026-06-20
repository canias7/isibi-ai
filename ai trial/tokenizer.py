# Step 1 — read the whole file into a variable called text
text = open("input.txt", encoding="utf-8").read()
print("Total characters:", len(text))

# Step 2 — find the vocabulary: the unique characters, sorted
chars = sorted(set(text))
vocab_size = len(chars)
print("Vocab size:", vocab_size)
print("Characters:", chars)
