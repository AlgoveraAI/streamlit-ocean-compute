import setuptools

setuptools.setup(
    name="streamlit-ocean-compute",
    version="0.0.1",
    author="AlgoveraAI",
    author_email="hello@algovera.ai",
    description="Streamlit component for running compute-to-data with Ocean Protocol",
    long_description="",
    long_description_content_type="text/plain",
    url="",
    packages=setuptools.find_packages(),
    include_package_data=True,
    classifiers=[],
    python_requires=">=3.6",
    install_requires=[
        # By definition, a Custom Component depends on Streamlit.
        # If your component has other Python dependencies, list
        # them here.
        "streamlit >= 0.63",
        "streamlit-wallet-connect"
    ],
)
